# Phase-ordered backlog — Mobily Transformation & Transactions Hub

Generated from `docs/requirements/requirements.yaml` (the register is authoritative; if this file and the register disagree, the register wins and this file must be regenerated/corrected). Owner: delivery-orchestrator.

## How to read this backlog

- **Phases** follow master prompt §19. Each phase: scope + REQ IDs + tests first → runnable increment → real verification → at least two independent reviews in separate contexts (QA + domain/security/architecture) → fix → gate report `docs/phases/Pn-gate-report.json`. No PASS with open Critical/High findings or unexecuted verification.
- **Epics** group stories by module. **Stories** are requirement IDs; the story text is the `user_story` in the register.
- **AT** = master prompt §20 acceptance scenario(s) the story must satisfy (in addition to the UT/IT/E2E/EVAL tests listed in the register).
- **Owner** = proposed implementing agent role (`.claude/agents/`). `ux-frontend` is added as co-owner when the story has a screen. `orchestrator` owns process/gate artifacts. Shared contracts, migrations and the lockfile stay with the single owner named in `CLAUDE.md` (delivery-orchestrator) and are sequenced.
- **Reviewers** = independent reviewers required for the story (phase minimum from §19 plus domain/security/architecture where the story touches those concerns). An implementer never reviews its own story; QA-owned stories are reviewed by the independent release reviewer.
- Abbreviations: backend = backend-data-engineer, ux-frontend = ux-frontend-engineer, ai-runtime = ai-runtime-engineer, integration-reporting = integration-reporting-engineer, devops = devops-platform-engineer, QA = qa-test-engineer, domain = carveout-domain-analyst, security = security-privacy-reviewer, architecture = solution-architect, release-reviewer = independent-release-reviewer, orchestrator = delivery-orchestrator.

## Sequencing principles

1. **Thin end-to-end slice first (P1→P2):** create project from template → assign owner → submit decision → record approval with authority check → action with closure evidence → report impact (AT-30). Every later module plugs into this pipeline (Auth → Policy → Zod → domain rule → one transaction with audit + outbox → worker).
2. **Isolation before breadth:** RLS, composite FKs, 404-not-403 and scoped counts are P1 exit criteria; every later phase re-runs the two-project isolation suite (AT-03) for its new read paths.
3. **Business rules live in `packages/domain`** (state machines, gate evaluation, CPM, RAG, money) and are unit-tested before controllers/screens are wired.
4. **Demo data never blocks production correctness:** demo seeds grow per phase (blocked CP, TSA issue, out-of-authority decision) but are flagged `is_demo` and excluded from actual reporting.
5. **External dependencies are isolated:** SSO, Mobily infrastructure, approved AI endpoints, M365 and VDR integrations are built behind adapters and reported as Not configured / Simulated until real configuration is authorized.

## Phase summary

| Phase | Name | Stories | must | Acceptance scenarios covered |
|---|---|---:|---:|---|
| P1 | Secure Foundation | 82 | 80 | AT-01, AT-02, AT-03, AT-14, AT-16, AT-19, AT-22, AT-26, AT-28, AT-29, AT-30 |
| P2 | Governance & Delivery | 85 | 83 | AT-03, AT-04, AT-05, AT-06, AT-07, AT-12, AT-13, AT-14, AT-15, AT-16, AT-19, AT-25, AT-27, AT-30 |
| P3 | Carve-out & NewCo | 37 | 37 | AT-01, AT-06, AT-07, AT-08, AT-09, AT-10 |
| P4 | JV & Finance | 39 | 39 | AT-03, AT-04, AT-10, AT-11, AT-12, AT-13, AT-19, AT-29 |
| P5 | Proactive AI PM | 45 | 42 | AT-03, AT-12, AT-17, AT-18, AT-19, AT-20, AT-21, AT-22, AT-28 |
| P6 | Reporting & Interoperability | 45 | 42 | AT-01, AT-03, AT-10, AT-12, AT-14, AT-19, AT-24, AT-25, AT-30 |
| P7 | Enterprise Readiness | 30 | 25 | AT-03, AT-21, AT-22, AT-23 |
| P8 | Pilot & Handover | 10 | 10 | AT-30 |

P0 (Discovery & Blueprint) items: 21 — listed in the appendix; they are satisfied by the P0 blueprint documents and reviews rather than by code.

## P1 — Secure Foundation

**Required outputs (§19):** Running application, database/migrations, development identity, portfolio UI, template-based project creation, RBAC/ABAC, audit, CI.  
**Exit criteria (§19):** Persistence after restart; two isolated projects; denied unauthorized access. Reviews: security + QA.  
**Minimum independent reviewers:** security, QA

### Epic P1.1 — Platform foundation (mutation pipeline, isolation, API conventions)

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PLT-001 | Configurable platform working name | should | — | backend + ux-frontend | security, QA |
| REQ-PLT-002 | Working application, not mockups or browser-local data | must | AT-30 | backend | security, QA |
| REQ-PLT-004 | No fabricated business facts anywhere | must | AT-28 | backend | security, QA |
| REQ-PLT-007 | No external publication or real messages without authorization | must | AT-22 | backend + ux-frontend | security, QA |
| REQ-ARC-001 | TypeScript monorepo with Next.js and NestJS | must | — | backend | architecture, security, QA |
| REQ-ARC-002 | PostgreSQL source of truth with constraints; optional pgvector | must | — | backend | architecture, security, QA |
| REQ-ARC-003 | One documented ORM; isolation not assumed from ORM | must | — | backend | architecture, security, QA |
| REQ-ARC-004 | Separate worker for scheduling, reporting and AI | must | — | backend | architecture, security, QA |
| REQ-ARC-005 | Object storage and file services via adapters | must | — | backend + ux-frontend | architecture, security, QA |
| REQ-ARC-007 | OpenAPI, schemas and safe generated client | must | — | backend | architecture, security, QA |
| REQ-ARC-010 | Pinned supported versions and licence checks | must | — | backend | architecture, security, QA |
| REQ-ARC-011 | Modular monolith plus worker | must | — | backend | architecture, security, QA |
| REQ-ARC-012 | No external SaaS for core platform services | must | AT-22 | backend | architecture, security, QA |
| REQ-ARC-013 | Core module set | must | — | backend | architecture, security, QA |
| REQ-ARC-014 | Mandatory mutation flow | must | — | backend | architecture, security, QA |
| REQ-DAT-002 | Project scoping and cross-project link prevention | must | AT-03 | backend | architecture, security, QA |
| REQ-DAT-005 | Optimistic concurrency | must | AT-16 | backend | architecture, security, QA |
| REQ-DAT-009 | Soft deletion | must | — | backend | architecture, security, QA |
| REQ-DAT-015 | API versioning, pagination and filtering | must | — | backend | architecture, security, QA |
| REQ-DAT-017 | Validation and secret-free error logs | must | — | backend | architecture, security, QA |
| REQ-SEC-006 | Isolation in APIs and database row policies | must | AT-03 | backend | security, QA |
| REQ-SEC-016 | CSRF, XSS, injection and IDOR protection | must | — | backend | security, QA |
| REQ-SET-001 | Demo sandbox DC project | must | — | backend + ux-frontend | domain, security, QA |
| REQ-SET-003 | Second transformation project for isolation tests | must | AT-02, AT-03 | backend + ux-frontend | domain, security, QA |
| REQ-SET-006 | Production bootstrap without invented content | must | — | backend | domain, security, QA |

### Epic P1.2 — Identity, sessions and access control

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-ENT-011 | Multi-level role scopes | must | — | backend + ux-frontend | security, QA |
| REQ-SEC-001 | Proposed role catalogue | must | — | backend + ux-frontend | security, QA |
| REQ-SEC-002 | Infrastructure administration separate from content access | must | — | backend + ux-frontend | security, QA |
| REQ-SEC-003 | RBAC plus ABAC, deny by default | must | AT-03 | backend | security, QA |
| REQ-SEC-009 | Session expiry and revocation | must | AT-19 | backend + ux-frontend | security, QA |
| REQ-SEC-010 | Separate service accounts with least privilege | must | — | backend + ux-frontend | security, QA |
| REQ-SEC-024 | Development identity isolated, no default passwords | must | — | backend | security, QA |
| REQ-SET-008 | No default passwords or backdoor accounts | must | — | backend | domain, security, QA |

### Epic P1.3 — Audit, retention and integrity

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-DAT-006 | Append-only audit with full context | must | — | backend + ux-frontend | architecture, security, QA |
| REQ-DAT-008 | Honest tamper-evidence claims | must | — | backend | architecture, security, QA |

### Epic P1.4 — Portfolio and enterprise structure

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-ENT-002 | Enterprise hierarchy | must | — | backend + ux-frontend | security, QA |
| REQ-ENT-003 | Legal entities separate from projects | must | — | backend + ux-frontend | security, QA |
| REQ-ENT-006 | Add projects through administration only | must | AT-02, AT-30 | backend + ux-frontend | security, QA |

### Epic P1.5 — Templates, project configuration and setup

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SRC-002 | Map reference headings to template scope | must | — | backend + ux-frontend | domain, security, QA |
| REQ-ENT-001 | First template: DC Carve-out to NewCo to JV | must | AT-02 | backend + ux-frontend | security, QA |
| REQ-ENT-005 | Per-project template and multiple template types | must | AT-02 | backend + ux-frontend | security, QA |
| REQ-ENT-007 | Template-configurable phases, gates, fields, forms, workflows and KPIs | must | — | backend + ux-frontend | security, QA |
| REQ-ENT-008 | Template versioning with stable project binding | must | AT-26 | backend + ux-frontend | security, QA |
| REQ-ENT-009 | Template upgrade requires preview and approval | must | AT-26 | backend + ux-frontend | security, QA |
| REQ-WS-001 | Twelve editable initial workstreams | must | — | backend + ux-frontend | domain, security, QA |
| REQ-WS-002 | Minimum scope per workstream seeded | must | — | backend + ux-frontend | domain, security, QA |
| REQ-WS-004 | Proposed WBS of at least 80 useful activities | must | — | backend + ux-frontend | domain, security, QA |
| REQ-WS-005 | WBS activity attributes | must | — | backend + ux-frontend | domain, security, QA |
| REQ-WS-006 | No invented dates or people in WBS | must | — | backend + ux-frontend | domain, security, QA |
| REQ-SET-009 | Wizard step 1: program, objective, parties and sites | must | — | backend + ux-frontend | domain, security, QA |

### Epic P1.6 — Documents, evidence and source register

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SRC-003 | Historical statuses kept as source-reported values only | must | AT-01 | backend + ux-frontend | domain, security, QA |
| REQ-SRC-004 | Unclear names, dates and figures remain unverified | must | AT-01 | backend + ux-frontend | domain, security, QA |
| REQ-SRC-005 | Source Register identification fields | must | — | backend + ux-frontend | domain, security, QA |
| REQ-SRC-006 | Separate dates and supporting location per claim | must | — | backend + ux-frontend | domain, security, QA |
| REQ-SRC-007 | Claim value, confidence, review and conflict tracking | must | AT-14 | backend + ux-frontend | domain, security, QA |
| REQ-SRC-008 | Verification status vocabulary enforced | must | — | backend + ux-frontend | domain, security, QA |
| REQ-DAT-012 | Explicit attachments, exports and access; no public links | must | — | backend + ux-frontend | architecture, security, QA |

### Epic P1.7 — Integrated planning, RAID, change and measurement

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-WS-007 | Initial activity status Draft/Unverified | must | AT-01 | backend + ux-frontend | domain, security, QA |

### Epic P1.8 — Finance, business plan, valuation references and benefits

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-DAT-003 | Decimal money with currency, units and periods | must | AT-29 | backend + ux-frontend | architecture, security, QA |

### Epic P1.9 — Reporting, KPIs, snapshots and exports

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SET-005 | Demo data labelled and excluded from actual reporting | must | — | integration-reporting + ux-frontend | domain, security, QA |

### Epic P1.10 — Integrations and adapters

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PLT-006 | Honest implementation and integration status | must | — | integration-reporting + ux-frontend | security, QA |

### Epic P1.11 — Web experience: screens, i18n, accessibility

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PLT-005 | Every primary action backed end to end | must | AT-30 | ux-frontend | security, QA |
| REQ-UX-001 | Switchable Arabic RTL and English LTR | must | — | ux-frontend | security, QA |
| REQ-UX-002 | i18n for UI text, English technical names | must | — | ux-frontend | security, QA |
| REQ-UX-003 | Corporate blue/white theme, no fabricated logo | should | — | ux-frontend | security, QA |
| REQ-UX-004 | Screen 1: Portfolio Home | must | AT-02 | ux-frontend | security, QA |
| REQ-UX-019 | Screen 16a: Administration (templates, users, permissions, identity) | must | — | ux-frontend | security, QA |
| REQ-UX-028 | Demo data clearly labelled | must | — | ux-frontend | security, QA |
| REQ-ARC-015 | Frontend never touches DB or LLM secrets; MCP optional | must | — | ux-frontend | architecture, security, QA |

### Epic P1.12 — Deployment, operations and private hosting

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SEC-012 | Secrets management and rotation | must | — | devops | security, QA |
| REQ-DEP-002 | Mode: Local Development | must | — | devops | architecture, security, QA |
| REQ-DEP-007 | Docker Compose for development/evaluation | must | — | devops | architecture, security, QA |
| REQ-DEP-010 | Secret-free env examples and unsafe-config rejection | must | — | devops | architecture, security, QA |
| REQ-DEP-022 | Continuous integration pipeline | must | — | devops | architecture, security, QA |

### Epic P1.13 — Delivery process, gate evidence and artifacts

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-ARC-008 | Unit, integration, E2E and accessibility testing | must | — | QA | architecture, security, release-reviewer |
| REQ-AGT-011 | Single owner for shared contracts, migrations and lockfiles | must | — | orchestrator | security, QA |
| REQ-PHS-001 | Sequential phases with early end-to-end journey | must | AT-30 | orchestrator | security, QA |
| REQ-PHS-003 | P1 exit: persistence, isolation and denied access | must | AT-02, AT-03 | orchestrator | security, QA |
| REQ-PHS-011 | Scope and tests before implementation; runnable increments | must | — | orchestrator | security, QA |
| REQ-PHS-012 | No pass with open Critical/High or unexecuted verification | must | — | orchestrator | security, QA |
| REQ-PHS-013 | Lower-severity issues recorded; mandatory scope retained | must | — | orchestrator | security, QA |
| REQ-PHS-024 | Code deliverables | must | — | devops | security, QA |

## P2 — Governance & Delivery

**Required outputs (§19):** Committee/meetings/decisions/actions, WBS/RAID/change/baselines/gates, initial dashboard.  
**Exit criteria (§19):** Decision request → authorized approval → action → closure evidence; decisions outside authority blocked. Reviews: domain + QA.  
**Minimum independent reviewers:** domain, QA

### Epic P2.1 — Platform foundation (mutation pipeline, isolation, API conventions)

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-DAT-013 | Domain commands; CRUD cannot change state | must | — | backend | architecture, domain, QA |
| REQ-DAT-014 | Reassessment and cache invalidation on change | must | AT-14 | backend + ux-frontend | architecture, domain, QA |

### Epic P2.2 — Audit, retention and integrity

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SEC-019 | Sensitive-access logging | must | — | backend + ux-frontend | security, domain, QA |

### Epic P2.3 — Portfolio and enterprise structure

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-ENT-004 | Portfolio, program, project and workstream views | must | — | backend + ux-frontend | domain, QA |

### Epic P2.4 — Templates, project configuration and setup

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PLN-019 | Configurable RAG thresholds with explanations | must | — | backend + ux-frontend | domain, QA |

### Epic P2.5 — Documents, evidence and source register

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-ENT-013 | No inference of confidential documents | must | AT-03 | backend + ux-frontend | security, domain, QA |
| REQ-DAT-010 | Retention and legal hold enforcement | must | AT-27 | backend + ux-frontend | architecture, security, domain, QA |
| REQ-SEC-013 | File validation and malware quarantine | must | AT-25 | backend + ux-frontend | security, domain, QA |

### Epic P2.6 — Committee and decision lifecycle

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-GOV-001 | Committee Workspace linked to the program | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-002 | Multiple committees and delegated authority levels | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-003 | Program committee distinct from NewCo and JV boards | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-004 | Approvable draft committee charter | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-005 | Charter roles and proposed functional membership | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-006 | Chair never defaulted | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-007 | Membership, quorum, voting and conflict rules | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-008 | Classification, access, minutes retention and escalation | must | — | backend + ux-frontend | security, domain, QA |
| REQ-GOV-009 | Configurable proposed meeting cadence | should | — | backend + ux-frontend | domain, QA |
| REQ-GOV-010 | No production approval authority before delegation approved | must | AT-04 | backend + ux-frontend | domain, QA |
| REQ-GOV-011 | Quorum, thresholds and limits from approved data | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-012 | Agenda request and secretariat screening | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-013 | Numbered agendas linked to issues and decisions | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-014 | Decision paper completeness | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-015 | Quorum and conflict checks before voting | must | AT-05 | backend + ux-frontend | domain, QA |
| REQ-GOV-016 | Voting, circulation and attendance/vote/recusal records | must | AT-05 | backend + ux-frontend | domain, QA |
| REQ-GOV-017 | Minutes drafting and approval | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-018 | Actions, implementation tracking and verified closure | must | AT-30 | backend + ux-frontend | domain, QA |
| REQ-GOV-019 | Decision state machine | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-020 | Approval separate from execution | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-021 | Frozen meeting packs with versioned changes | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-022 | Approvals enforce delegated authority | must | AT-04, AT-05 | backend + ux-frontend | domain, QA |
| REQ-GOV-023 | Out-of-mandate decisions become recommendations | must | AT-04 | backend + ux-frontend | domain, QA |
| REQ-GOV-024 | Historical votes immutable despite membership changes | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-025 | Escalations with action, deadline and options | must | — | backend + ux-frontend | domain, QA |
| REQ-GOV-027 | Internal approvals are not legal signatures | must | — | backend + ux-frontend | domain, QA |
| REQ-SEC-004 | Segregation of request and approval; no self-approval | must | AT-05 | backend + ux-frontend | security, domain, QA |
| REQ-SEC-005 | Protected quorum calculation | must | AT-05 | backend + ux-frontend | security, domain, QA |
| REQ-SET-013 | Wizard step 5: committee, delegation and quorum | must | AT-04 | backend + ux-frontend | domain, QA |

### Epic P2.7 — Integrated planning, RAID, change and measurement

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-ENT-010 | Cross-project dependencies with minimum disclosure | must | AT-03 | backend + ux-frontend | domain, QA |
| REQ-WS-003 | Workstream required elements | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-001 | Connected planning modules | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-003 | Single accountable owner plus RACI | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-004 | Baseline versions with separate forecast and actual | must | AT-16 | backend + ux-frontend | domain, QA |
| REQ-PLN-005 | Acyclic dependency graph | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-006 | Dependencies link approvals, agreements, evidence, decisions and gates | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-007 | FS relationships, lag and working calendars first | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-008 | Critical path and float only for supported relationships | must | AT-15 | backend + ux-frontend | domain, QA |
| REQ-PLN-009 | Incomplete schedule when data missing | must | AT-15 | backend + ux-frontend | domain, QA |
| REQ-PLN-010 | Asia/Riyadh calendar, UTC timestamps and local business dates | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-011 | Task states, verified progress and acceptance | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-012 | RAID register | must | — | backend + ux-frontend | security, domain, QA |
| REQ-PLN-013 | Change requests with impacts and rebaselining | must | AT-07, AT-16 | backend + ux-frontend | domain, QA |
| REQ-PLN-014 | Responsibility matrix and owner conflicts | should | — | backend + ux-frontend | domain, QA |
| REQ-PLN-015 | Periodic updates with review and frozen versions | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-016 | Progress weighted by approved deliverable weights | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-017 | Show denominator and exclusions | must | — | backend + ux-frontend | domain, QA |
| REQ-PLN-023 | Schedule-based forecasts, no LLM delay probabilities | must | AT-15 | backend + ux-frontend | domain, QA |
| REQ-PLN-024 | Predecessor delay impact analysis | must | AT-15 | backend + ux-frontend | domain, QA |
| REQ-SET-014 | Wizard step 6: baseline and gates | must | — | backend + ux-frontend | domain, QA |

### Epic P2.8 — Business gates, criteria, waivers and status dimensions

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-LCY-001 | Business lifecycle separate from software phases | must | — | backend + ux-frontend | domain, QA |
| REQ-LCY-002 | G0 Mandate & Governance gate template | must | — | backend + ux-frontend | domain, QA |
| REQ-LCY-005 | Gate evidence is a proposal; applicability set by specialists | must | — | backend + ux-frontend | domain, QA |
| REQ-LCY-010 | Complete gate structure | must | — | backend + ux-frontend | domain, QA |
| REQ-LCY-011 | Task completion never unlocks a gate | must | AT-12 | backend + ux-frontend | domain, QA |
| REQ-LCY-012 | Non-waivable conditions cannot be overridden | must | AT-13 | backend + ux-frontend | domain, QA |
| REQ-LCY-013 | Waivability, waiver authority and waiver record | must | AT-13 | backend + ux-frontend | domain, QA |
| REQ-LCY-015 | Controlled reassessment when evidence proves defective | must | AT-14 | backend + ux-frontend | domain, QA |

### Epic P2.9 — Notifications and outbound channel control

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PLT-008 | Internal in-app notifications through the outbox | must | AT-19 | backend + ux-frontend | security, domain, QA |

### Epic P2.10 — Reporting, KPIs, snapshots and exports

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PLN-018 | Green average never hides red CP or blocker | must | AT-12 | integration-reporting + ux-frontend | domain, QA |
| REQ-PLN-020 | Unknown and stale data never Green | must | — | integration-reporting + ux-frontend | domain, QA |
| REQ-PLN-021 | Manual RAG override with reason, expiry and reviewer | must | — | integration-reporting + ux-frontend | domain, QA |
| REQ-PLN-022 | Recalculate metrics while preserving snapshots | must | — | integration-reporting + ux-frontend | domain, QA |

### Epic P2.11 — Web experience: screens, i18n, accessibility

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PLN-002 | WBS list, table, Kanban and Gantt views | must | — | ux-frontend | domain, QA |
| REQ-UX-005 | Screen 2: DC Executive Cockpit | must | AT-06 | ux-frontend | domain, QA |
| REQ-UX-006 | Screen 3: Program Overview & Charter | must | — | ux-frontend | domain, QA |
| REQ-UX-007 | Screen 4: Committee Hub | must | AT-04 | ux-frontend | security, domain, QA |
| REQ-UX-008 | Screen 5: Integrated Plan | must | AT-15 | ux-frontend | domain, QA |
| REQ-UX-009 | Screen 6: Workstream Workspace | must | — | ux-frontend | domain, QA |
| REQ-UX-015 | Screen 12: RAID & Change Control | must | AT-07 | ux-frontend | domain, QA |
| REQ-UX-016 | Screen 13: Document & Evidence Center | must | AT-03 | ux-frontend | security, domain, QA |
| REQ-UX-018 | Screen 15: My Work / Inbox | must | AT-30 | ux-frontend | domain, QA |
| REQ-UX-021 | Search and filtering on every screen | must | AT-03 | ux-frontend | security, domain, QA |
| REQ-UX-022 | Loading, empty, error and restricted-access states | must | — | ux-frontend | security, domain, QA |
| REQ-UX-023 | Activity history and source links | must | — | ux-frontend | security, domain, QA |
| REQ-UX-024 | Metric drill-down to contributing records | must | — | ux-frontend | domain, QA |

### Epic P2.12 — Delivery process, gate evidence and artifacts

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PHS-004 | P2 exit: authorized decision journey | must | AT-04, AT-05 | orchestrator | domain, QA |

## P3 — Carve-out & NewCo

**Required outputs (§19):** Perimeter, transfer/consent/agreement registers, incorporation, TSAs, site/Day-1/cutover readiness.  
**Exit criteria (§19):** Incorporation recorded while transfer/operations incomplete; blockers prevent go-live; perimeter-change impact. Reviews: domain + security/QA.  
**Minimum independent reviewers:** domain, security, QA

### Epic P3.1 — Business gates, criteria, waivers and status dimensions

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-LCY-003 | G1–G4 separation gate templates | must | — | backend + ux-frontend | domain, security, QA |
| REQ-LCY-006 | Four independent status dimensions | must | AT-06 | backend + ux-frontend | domain, security, QA |

### Epic P3.2 — Perimeter, transfers, agreements and consents

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PER-001 | Perimeter item attributes | must | — | backend + ux-frontend | domain, security, QA |
| REQ-PER-002 | Included/Excluded/Shared/Pending classification | must | — | backend + ux-frontend | domain, security, QA |
| REQ-PER-003 | Full perimeter category coverage | must | — | backend + ux-frontend | domain, security, QA |
| REQ-PER-004 | Perimeter change impact analysis | must | AT-07 | backend + ux-frontend | domain, security, QA |
| REQ-PER-005 | Post-baseline perimeter change via change request | must | AT-07 | backend + ux-frontend | domain, security, QA |
| REQ-PER-006 | Reconciliation of items lacking plan or evidence | must | — | backend + ux-frontend | domain, security, QA |
| REQ-PER-007 | Transfer records verified by command | must | AT-06 | backend + ux-frontend | domain, security, QA |
| REQ-AGR-001 | Agreement Register | must | — | backend + ux-frontend | domain, security, QA |
| REQ-AGR-002 | No assumed abbreviation expansions | must | — | backend + ux-frontend | domain, security, QA |
| REQ-AGR-003 | Agreement tracking attributes | must | — | backend + ux-frontend | domain, security, QA |
| REQ-AGR-005 | External-party and internal approval registers | must | — | backend + ux-frontend | domain, security, QA |
| REQ-AGR-006 | Contract transferability classification by specialists | must | AT-08 | backend + ux-frontend | domain, security, QA |
| REQ-AGR-008 | Consent tracking and Day-1 contract exceptions | must | AT-08 | backend + ux-frontend | domain, security, QA |
| REQ-SET-012 | Wizard step 4: approve perimeter, workstreams and owners | must | — | backend + ux-frontend | domain, security, QA |

### Epic P3.3 — NewCo incorporation and regulatory readiness

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-LCY-007 | Registered NewCo with incomplete transfer displayed accurately | must | AT-06 | backend + ux-frontend | domain, security, QA |
| REQ-AGR-004 | Regulatory approval register | must | — | backend + ux-frontend | domain, security, QA |
| REQ-AGR-007 | No assertion that licenses/approvals are mandatory or obtained | must | AT-01 | backend + ux-frontend | domain, security, QA |
| REQ-SET-010 | Wizard step 2: NewCo status with evidence | must | AT-06 | backend + ux-frontend | domain, security, QA |

### Epic P3.4 — Day-1 readiness, cutover and TSA

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-LCY-014 | Independence definition includes TSAs and enduring arrangements | must | — | backend + ux-frontend | domain, security, QA |
| REQ-TSA-001 | TSA service attributes | must | — | backend + ux-frontend | domain, security, QA |
| REQ-TSA-002 | TSA state machine | must | — | backend + ux-frontend | domain, security, QA |
| REQ-TSA-003 | End date is not a successful exit | must | AT-10 | backend + ux-frontend | domain, security, QA |
| REQ-TSA-004 | Replacement failure triggers escalation and continuity planning | must | AT-10 | backend + ux-frontend | domain, security, QA |
| REQ-TSA-005 | No automatic TSA extension | must | AT-10 | backend + ux-frontend | domain, security, QA |
| REQ-TSA-006 | approveTSAExit requires replacement acceptance evidence | must | AT-10 | backend + ux-frontend | domain, security, QA |
| REQ-RDY-001 | Site/workstream readiness checklists with blockers and sign-offs | must | AT-09 | backend + ux-frontend | domain, security, QA |
| REQ-RDY-002 | Readiness domain coverage | must | — | backend + ux-frontend | domain, security, QA |
| REQ-RDY-003 | Cutover plan required elements | must | — | backend + ux-frontend | domain, security, QA |
| REQ-RDY-004 | Failed blocker prevents go-live, with contingency and history | must | AT-09 | backend + ux-frontend | domain, security, QA |
| REQ-RDY-005 | Post-transition acceptance | must | — | backend + ux-frontend | domain, security, QA |
| REQ-RDY-006 | No control of data center devices | must | — | backend + ux-frontend | domain, security, QA |

### Epic P3.5 — Web experience: screens, i18n, accessibility

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-UX-010 | Screen 7: Perimeter & Transfers | must | AT-07 | ux-frontend | domain, security, QA |
| REQ-UX-011 | Screen 8: NewCo & Regulatory Readiness | must | AT-06 | ux-frontend | domain, security, QA |
| REQ-UX-012 | Screen 9: Day-1 & TSA Center | must | AT-09, AT-10 | ux-frontend | domain, security, QA |

### Epic P3.6 — Delivery process, gate evidence and artifacts

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PHS-005 | P3 exit: separation states, blockers and perimeter impact | must | AT-06, AT-07, AT-08, AT-09, AT-10 | orchestrator | domain, security, QA |

## P4 — JV & Finance

**Required outputs (§19):** Business plans/valuation references, costs/benefits, partner/DD/Q&A, signing/closing/CPs/post-close.  
**Exit criteria (§19):** Missing CP blocks closing; partner isolation; NDA alone insufficient; financial reconciliation. Reviews: domain/security/QA.  
**Minimum independent reviewers:** domain, security, QA

### Epic P4.1 — Platform foundation (mutation pipeline, isolation, API conventions)

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SET-004 | Demo scenarios: blocked CP, TSA issue, out-of-authority decision | must | AT-04, AT-10, AT-12 | backend + ux-frontend | domain, security, QA |

### Epic P4.2 — Integrated planning, RAID, change and measurement

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-LCY-008 | Partner preparation in parallel with separation | must | AT-11 | backend + ux-frontend | domain, security, QA |

### Epic P4.3 — Business gates, criteria, waivers and status dimensions

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-LCY-004 | G5–G7 transaction gate templates | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-019 | Program closure follows its own handover criteria | must | — | backend + ux-frontend | domain, security, QA |

### Epic P4.4 — Finance, business plan, valuation references and benefits

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-FIN-001 | Baseline, forecast and actual financials | must | — | backend + ux-frontend | domain, security, QA |
| REQ-FIN-002 | Separation cost categories without double counting | must | — | backend + ux-frontend | domain, security, QA |
| REQ-FIN-003 | Committed versus spent | must | — | backend + ux-frontend | domain, security, QA |
| REQ-FIN-004 | Working capital, opening balances and intercompany reconciliation | must | — | backend + ux-frontend | domain, security, QA |
| REQ-FIN-005 | Versioned business plans and valuation cases | must | — | backend + ux-frontend | domain, security, QA |
| REQ-FIN-006 | Proposed versus approved valuation and ownership | must | — | backend + ux-frontend | domain, security, QA |
| REQ-FIN-007 | EV/equity and unit/currency confusion checks | must | AT-29 | backend + ux-frontend | domain, security, QA |
| REQ-FIN-008 | Import financial model outputs linked to sources | must | — | backend + ux-frontend | domain, security, QA |
| REQ-FIN-009 | Benefits Register | must | — | backend + ux-frontend | domain, security, QA |
| REQ-FIN-010 | Human financial validation before approval | must | — | backend + ux-frontend | domain, security, QA |
| REQ-DAT-004 | No invalid cross-currency/unit aggregation | must | AT-29 | backend + ux-frontend | architecture, domain, security, QA |

### Epic P4.5 — Partner process, diligence, signing and closing

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-LCY-009 | Signing separate from Closing; multiple closings | must | AT-11 | backend + ux-frontend | domain, security, QA |
| REQ-ENT-012 | Partner, advisor and Clean Team data separation | must | AT-03 | backend + ux-frontend | domain, security, QA |
| REQ-JV-001 | Access-controlled Partner Workspace | must | AT-03 | backend + ux-frontend | domain, security, QA |
| REQ-JV-002 | Partner longlist/shortlist with criteria and conflicts | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-003 | Partner engagement stages | must | AT-11 | backend + ux-frontend | domain, security, QA |
| REQ-JV-004 | Outreach approval separate | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-005 | NDA alone does not grant document access | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-006 | Proposals and assessments separating fact from judgement | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-007 | Versioned ownership and governance scenarios | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-008 | Terms and negotiation issues register | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-009 | VDR index, permissions and disclosure history | must | AT-19 | backend + ux-frontend | domain, security, QA |
| REQ-JV-010 | DD requests and Q&A workflow | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-011 | Diligence findings with implications | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-012 | Separate signing and closing checklists | must | AT-11 | backend + ux-frontend | domain, security, QA |
| REQ-JV-013 | Condition precedent attributes and verification | must | AT-12 | backend + ux-frontend | domain, security, QA |
| REQ-JV-014 | Closing deliverables, decisions and executed documents | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-015 | Track financial flows without executing payments | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-016 | Conditions subsequent and post-close obligations | must | — | backend + ux-frontend | domain, security, QA |
| REQ-JV-017 | Task completion does not close the transaction | must | AT-12 | backend + ux-frontend | domain, security, QA |
| REQ-JV-018 | Missing mandatory CP blocks closing | must | AT-12, AT-13 | backend + ux-frontend | domain, security, QA |
| REQ-SET-002 | Two fictional demo partners | must | AT-03 | backend + ux-frontend | domain, security, QA |

### Epic P4.6 — Web experience: screens, i18n, accessibility

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-UX-013 | Screen 10: Finance & Value | must | AT-29 | ux-frontend | domain, security, QA |
| REQ-UX-014 | Screen 11: JV & Diligence | must | AT-11, AT-12 | ux-frontend | domain, security, QA |

### Epic P4.7 — Delivery process, gate evidence and artifacts

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PHS-006 | P4 exit: CP blocking, partner isolation, NDA, reconciliation | must | AT-11, AT-12, AT-13, AT-29 | orchestrator | domain, security, QA |

## P5 — Proactive AI PM

**Required outputs (§19):** Ingestion/RAG, constrained tools, modes, proposals/approvals, scheduler/worker, kill switch, evaluations.  
**Exit criteria (§19):** Scheduled briefing after browser closes; valid citations/permissions; no duplicate actions; prompt-injection resistance. Reviews: security + QA.  
**Minimum independent reviewers:** security, QA

### Epic P5.1 — Notifications and outbound channel control

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-AI-035 | Outbound channels disabled until authorized | must | AT-22 | backend + ux-frontend | security, QA |

### Epic P5.2 — Runtime AI Project Manager

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-AI-001 | Runtime AI PM distinct and durable | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-002 | Only authorized project knowledge sources | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-003 | Knowledge ingestion pipeline | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-004 | Cited retrieval answers; facts distinguished from inference | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-005 | Structured records authoritative; deterministic calculations | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-006 | ACL enforced before retrieval, per chunk and before output | must | AT-03 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-007 | No leakage through caches, embeddings, memory or logs | must | AT-03 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-008 | Invalidation on change, deletion or revocation | must | AT-19 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-009 | Show known, missing, conflicting and stale information | must | AT-28 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-010 | Scheduled daily briefings and weekly summaries | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-011 | Detect lateness, gaps, contradictions and bottlenecks | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-012 | Corrective action and recovery proposals | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-013 | Draft agendas, minutes, decision papers and reports | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-014 | Extract decisions and actions from minutes for review | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-015 | Weekly plan suggestions and data-owner requests | should | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-016 | Link service risks, CPs and TSA expiry to gates | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-017 | Answer program questions with gaps and references | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-018 | No legal determinations or validity declarations | must | AT-12 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-019 | Mode Off | must | AT-21 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-020 | Mode Advisory (default when enabled) | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-021 | Mode Assisted execution | must | AT-18 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-022 | Mode Policy-limited autopilot | should | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-023 | Per-project AI enablement | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-024 | AI permission matrix | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-025 | Prohibited autonomous actions | must | AT-12, AT-17 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-026 | Event triggers and schedules on durable queue | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-027 | Restricted service identity with fresh authorization | must | AT-19 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-028 | Idempotency, retries, dead-letter, dedup, cooldown and quiet hours | must | AT-20 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-029 | Complete AI action records including cost | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-030 | Approval bound to payload, version, approver and validity | must | AT-18 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-031 | Emergency stop | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-032 | Rollback and compensation for reversible changes | should | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-033 | Run health, next run and manual fallback | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-034 | Budget, time, token limits and circuit breakers | must | AT-21 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-036 | Imported content is untrusted data | must | AT-17 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-037 | Typed, narrowly scoped tools only | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-AI-038 | Arabic/English AI evaluation suite | must | AT-17, AT-19, AT-20, AT-28 | ai-runtime + ux-frontend | security, QA |
| REQ-AI-039 | AI acceptance thresholds without absolute guarantees | must | — | ai-runtime + ux-frontend | security, QA |
| REQ-SEC-018 | Classification, DLP and destination checks before AI | must | AT-17, AT-22 | ai-runtime + ux-frontend | security, QA |
| REQ-DEP-021 | Model Provider interface; AI optional | must | AT-21 | ai-runtime | architecture, security, QA |

### Epic P5.3 — Web experience: screens, i18n, accessibility

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-UX-017 | Screen 14: AI PM Center | must | AT-21 | ux-frontend | security, QA |

### Epic P5.4 — Delivery process, gate evidence and artifacts

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SEC-021 | Revocation tests for users, documents and permissions | must | AT-19 | QA | security, release-reviewer |
| REQ-PHS-007 | P5 exit: durable, grounded, safe AI | must | AT-17, AT-18, AT-19, AT-20, AT-21, AT-28 | orchestrator | security, QA |
| REQ-PHS-021 | AI documentation | must | — | ai-runtime | security, QA |

## P6 — Reporting & Interoperability

**Required outputs (§19):** Excel import, PDF/PPTX/DOCX/XLSX exports, committee packs, adapters, integration documentation.  
**Exit criteria (§19):** Reviewed sample import; reports reconcile to sources; correct RTL; honest connection status. Reviews: QA + architecture/domain.  
**Minimum independent reviewers:** architecture, QA

### Epic P6.1 — Platform foundation (mutation pipeline, isolation, API conventions)

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SEC-007 | Isolation in reports, search, AI, files, notifications and jobs | must | AT-03 | backend + ux-frontend | security, architecture, QA |
| REQ-SEC-014 | Path traversal and SSRF prevention | must | AT-25 | backend | security, architecture, QA |

### Epic P6.2 — Templates, project configuration and setup

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SET-007 | Onboarding approvals for real projects | must | — | backend + ux-frontend | domain, architecture, QA |
| REQ-SET-015 | Wizard step 7: confidentiality, retention, integrations and AI mode | must | — | backend + ux-frontend | domain, architecture, QA |
| REQ-SET-016 | Wizard step 8: launch monitoring with gap list | must | AT-30 | backend + ux-frontend | domain, architecture, QA |

### Epic P6.3 — Notifications and outbound channel control

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-INT-012 | Recheck permissions at every send | must | AT-19 | backend + ux-frontend | architecture, QA |

### Epic P6.4 — Reporting, KPIs, snapshots and exports

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-GOV-026 | Committee exports respect classification | must | AT-24 | integration-reporting + ux-frontend | security, domain, architecture, QA |
| REQ-RPT-001 | Reports generated from real system data | must | AT-24 | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-002 | One-page executive summary | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-003 | Committee pack | must | AT-24 | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-004 | Weekly workstream, look-ahead, overdue and escalation reports | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-005 | Day-1, TSA exit and JV signing/closing/CP reports | must | AT-10, AT-12 | integration-reporting + ux-frontend | security, architecture, QA |
| REQ-RPT-006 | Project health, data quality and changes since last report | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-007 | XLSX table exports | must | AT-25 | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-008 | PDF reports with verified Arabic output | must | AT-24 | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-009 | Basic PPTX committee packs | must | AT-24 | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-010 | DOCX minutes | must | AT-24 | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-011 | BI-ready views or documented API for Power BI | should | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-012 | Proposed KPI catalogue | must | — | integration-reporting + ux-frontend | security, architecture, QA |
| REQ-RPT-013 | KPI definition attributes | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-014 | KPIs without source data remain proposals | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-015 | Report metadata on every report | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-016 | Immutable report snapshots | must | AT-24 | integration-reporting + ux-frontend | architecture, QA |
| REQ-RPT-017 | Permission recheck on snapshot access | must | AT-03, AT-19 | integration-reporting + ux-frontend | architecture, QA |
| REQ-SEC-017 | CSV/Excel formula injection neutralized | must | AT-25 | integration-reporting | security, architecture, QA |
| REQ-INT-011 | Exports never auto-send externally | must | — | integration-reporting + ux-frontend | architecture, QA |

### Epic P6.5 — Imports and extraction

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SRC-009 | Compare-before-merge for workbook or minutes uploads | must | AT-01, AT-14 | integration-reporting + ux-frontend | domain, architecture, QA |
| REQ-SEC-015 | Sandboxed complex file conversion | must | AT-25 | integration-reporting | security, architecture, QA |
| REQ-INT-001 | Excel/CSV import wizard with duplicate detection | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-INT-002 | Source preservation, approval and batch history | must | AT-01 | integration-reporting + ux-frontend | architecture, QA |
| REQ-INT-003 | Import rollback where feasible | should | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-INT-004 | Safe image/PDF/DOCX import pipeline | must | AT-25 | integration-reporting + ux-frontend | architecture, QA |
| REQ-INT-005 | Unclear OCR never populates official fields | must | AT-01 | integration-reporting + ux-frontend | architecture, QA |
| REQ-INT-015 | Imports cannot overwrite governed records | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-SET-011 | Wizard step 3: import sources and review claims | must | AT-01 | integration-reporting + ux-frontend | domain, architecture, QA |

### Epic P6.6 — Integrations and adapters

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-INT-006 | Optional Microsoft 365 adapters with scopes and logs | should | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-INT-007 | Read-only connectors separate from write/send | must | — | integration-reporting + ux-frontend | security, architecture, QA |
| REQ-INT-008 | Future enterprise integrations documented only | must | — | integration-reporting | architecture, QA |
| REQ-INT-009 | Signed webhooks with replay protection | must | — | integration-reporting | architecture, QA |
| REQ-INT-010 | Idempotency, retries, reconciliation and monitoring | must | — | integration-reporting + ux-frontend | architecture, QA |
| REQ-INT-013 | Validated connectivity status | must | — | integration-reporting + ux-frontend | security, architecture, QA |
| REQ-INT-014 | Unavailable integrations Disabled with manual alternatives | must | — | integration-reporting + ux-frontend | architecture, QA |

### Epic P6.7 — Web experience: screens, i18n, accessibility

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-UX-020 | Screen 16b: Reports, integrations and deployment settings | must | AT-24 | ux-frontend | architecture, QA |
| REQ-UX-027 | RTL testing with mixed-language content | must | AT-24 | ux-frontend | architecture, QA |

### Epic P6.8 — Delivery process, gate evidence and artifacts

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PHS-008 | P6 exit: import, reconciled reports, RTL, honest status | must | AT-01, AT-24, AT-25 | orchestrator | architecture, QA |

## P7 — Enterprise Readiness

**Required outputs (§19):** Hardening, load tests, SSO adapter, Helm/container deployment, private/offline modes, backup/restore, runbooks.  
**Exit criteria (§19):** Fresh install and restore; two-project isolation with AI Off and egress blocked. Reviews: DevOps/security + independent QA.  
**Minimum independent reviewers:** security, QA

### Epic P7.1 — Platform foundation (mutation pipeline, isolation, API conventions)

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-ARC-009 | OpenTelemetry to internal collector | should | — | backend | architecture, security, QA |
| REQ-DAT-016 | Rate limits | must | — | backend | architecture, security, QA |
| REQ-DEP-011 | Adapters for infrastructure services | must | — | backend | architecture, security, QA |

### Epic P7.2 — Identity, sessions and access control

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-ARC-006 | OIDC/SAML identity with isolated dev identities | must | — | backend + ux-frontend | architecture, security, QA |
| REQ-SEC-008 | Enterprise authentication and MFA via IdP | must | — | backend + ux-frontend | security, QA |

### Epic P7.3 — Audit, retention and integrity

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-DAT-007 | Audit export to independent log repository | should | — | backend + ux-frontend | architecture, security, QA |

### Epic P7.4 — Documents, evidence and source register

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-DAT-011 | Authorized disposal procedure | should | — | backend + ux-frontend | architecture, security, QA |

### Epic P7.5 — Web experience: screens, i18n, accessibility

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-UX-025 | Desktop, tablet and mobile browsers | must | — | ux-frontend | security, QA |
| REQ-UX-026 | Accessibility: contrast, keyboard and screen readers | must | — | ux-frontend | security, QA |

### Epic P7.6 — Deployment, operations and private hosting

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SEC-011 | TLS and data/backup encryption | must | — | devops | security, QA |
| REQ-SEC-020 | Incident-response runbook | must | — | devops | security, QA |
| REQ-DEP-001 | Operational and cost components documented | must | — | devops | architecture, security, QA |
| REQ-DEP-003 | Mode: Mobily Private — AI Off | must | AT-21, AT-22 | devops | architecture, security, QA |
| REQ-DEP-004 | Mode: Mobily Private — Local AI | should | — | devops | architecture, security, QA |
| REQ-DEP-005 | Mode: Mobily Private — Approved AI Gateway | should | — | devops | architecture, security, QA |
| REQ-DEP-006 | Non-root production Dockerfiles with probes | must | — | devops | architecture, security, QA |
| REQ-DEP-008 | Customizable Helm/Kubernetes manifests; OpenShift constraints | must | — | devops | architecture, security, QA |
| REQ-DEP-009 | Ingress, TLS, private DNS, custom CA and proxy | must | — | devops | architecture, security, QA |
| REQ-DEP-012 | Private registry, SBOM, vulnerability and licence checks | must | — | devops | architecture, security, QA |
| REQ-DEP-013 | Operational runbooks | must | — | devops | architecture, security, QA |
| REQ-DEP-014 | Private mode blocks unapproved egress | must | AT-22 | devops | architecture, security, QA |
| REQ-DEP-015 | Separated environments and clean production transition | must | — | devops | architecture, security, QA |
| REQ-DEP-016 | Sizing assumptions and load-test plan | must | — | devops | architecture, security, QA |
| REQ-DEP-017 | Performance goals, limits and measured results | must | — | devops | architecture, security, QA |
| REQ-DEP-018 | Proposed RPO/RTO and tested, consistent restore | must | AT-23 | devops | architecture, security, QA |
| REQ-DEP-019 | Restore avoids mass job redelivery | must | AT-23 | devops | architecture, security, QA |

### Epic P7.7 — Delivery process, gate evidence and artifacts

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-SEC-022 | Compliance applicability matrix | must | — | devops | security, QA |
| REQ-SEC-023 | Separate data flows for hosting, AI, backups and support | must | — | devops | security, QA |
| REQ-PHS-009 | P7 exit: fresh install, restore, isolation with AI Off | must | AT-22, AT-23, AT-03 | orchestrator | security, QA |
| REQ-PHS-022 | Deployment documentation | must | — | devops | security, QA |

## P8 — Pilot & Handover

**Required outputs (§19):** UAT, user/admin guides, demo walkthrough, repository/deployment pack, limitations register, production transition plan.  
**Exit criteria (§19):** Critical journeys pass; independent review evidence; no open critical defects; Mobily production approvals documented as still required. Reviews: independent release reviewer + QA.  
**Minimum independent reviewers:** release-reviewer, QA

### Epic P8.1 — Deployment, operations and private hosting

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-DEP-020 | Enterprise handover checklist | must | — | devops | architecture, release-reviewer, QA |

### Epic P8.2 — Delivery process, gate evidence and artifacts

| Story | Title | Pri | AT | Owner | Reviewers |
|---|---|---|---|---|---|
| REQ-PLT-003 | End-to-end program management outcome | must | AT-30 | QA | release-reviewer |
| REQ-PHS-010 | P8 exit: critical journeys, evidence, no critical defects | must | AT-30 | orchestrator | release-reviewer, QA |
| REQ-PHS-016 | Acceptance scenarios linked to requirement, fixture and result | must | — | QA | release-reviewer |
| REQ-PHS-017 | README | must | — | devops | release-reviewer, QA |
| REQ-PHS-023 | Arabic/English user guides | must | — | ux-frontend | domain, release-reviewer, QA |
| REQ-PHS-026 | Reproducible full-scenario walkthrough | must | AT-30 | QA | release-reviewer |
| REQ-PHS-027 | Engineering verification separate from production approval; handover pack | must | — | orchestrator | release-reviewer, QA |
| REQ-PHS-028 | UAT execution | must | AT-30 | QA | domain, release-reviewer |
| REQ-PHS-029 | Limitations register and production transition plan | must | — | orchestrator | release-reviewer, QA |

## Appendix — P0 (Discovery & Blueprint) requirements

Satisfied by P0 documents (PRD, this backlog, requirement register, source register, assumptions, ERD, ADRs, threat model, governance drafts, agent definitions) and the P0 independent reviews (domain + architecture/QA).

| Requirement | Title | Evidence expected |
|---|---|---|
| REQ-SRC-001 | Record image unavailability and preliminary requirements | REVIEW: docs/source-register.md states image extraction not performed |
| REQ-SRC-010 | No sensitive Mobily files in unauthorized environments | REVIEW: repository and fixtures contain only synthetic Demo data |
| REQ-DAT-001 | ERD and data dictionary before implementation | REVIEW: docs/architecture ERD lists every section 14 entity |
| REQ-AGT-001 | Inspect repository and preserve previous work | REVIEW: WORK_LOG records repository inspection; sibling project untouched |
| REQ-AGT-002 | Complete requirement traceability chain | REVIEW: requirements.yaml validator — all fields present, all AT-xx referenced |
| REQ-AGT-003 | Documented assumptions; no halt on unknowns | REVIEW: docs/assumptions-and-open-questions.md lists assumptions with owners |
| REQ-AGT-004 | Consolidated critical question list | REVIEW: single open-questions list maintained |
| REQ-AGT-005 | Automatic phase advance; human approvals for business | REVIEW: gate reports show automatic advance only after PASS |
| REQ-AGT-006 | Agent definitions with content and tool limits | REVIEW: 11 agent files present and registration verified or limitation recorded; REVIEW: agent files include objective, files, tests, limits |
| REQ-AGT-007 | Eleven agent roles with boundaries | REVIEW: each definition states responsibility and boundary per section 18 table |
| REQ-AGT-008 | Two independent reviewers per phase with saved evidence | REVIEW: docs/reviews contains two independent reports per phase with revision ids |
| REQ-AGT-009 | Assignments carry REQ IDs, ownership and acceptance criteria | REVIEW: assignment briefs include REQ IDs and owned paths |
| REQ-AGT-010 | Parallelism within limits and without capability assumptions | REVIEW: WORK_LOG records actual delegation capabilities used |
| REQ-AGT-012 | Disclose when independent review cannot run | REVIEW: gate report marked BLOCKED when independent review missing |
| REQ-PHS-002 | P0 exit: traceability and blueprint reviewed | REVIEW: docs/phases/P0-gate-report.json with domain and architecture/QA verdicts |
| REQ-PHS-014 | Gate report format, storage and advance/block handling | REVIEW: gate report JSON validates against schema; REVIEW: each gate report references existing review files |
| REQ-PHS-015 | Checkpoint and resume | REVIEW: WORK_LOG updated after each integration |
| REQ-PHS-018 | CLAUDE.md project rules | REVIEW: CLAUDE.md commands match package.json scripts |
| REQ-PHS-019 | Core documentation set | REVIEW: each document present and reviewed in P0 |
| REQ-PHS-020 | Governance, architecture and security documentation | REVIEW: domain analyst review of governance docs; REVIEW: architecture review of ERD/ADRs; REVIEW: threat model reviewed in P0; control matrix completed in P7 |
| REQ-PHS-025 | Delivery status document | REVIEW: DELIVERY_STATUS matches requirements.yaml statuses |
