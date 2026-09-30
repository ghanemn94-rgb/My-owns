# P1 must requirements: status and disposition (closes QA-P1-03)

| Item | Value |
|---|---|
| Purpose | Every P1 `must` requirement has either executed test evidence (`Tested`) or an explicit disposition with owner and reason (QA-P1-03; master prompt §19 steps 6-7). Input for `docs/phases/P1-gate-report.json`. |
| Author | delivery-orchestrator, 2026-09-30, working tree at revision `7959b44` |
| Status source | `docs/requirements/status-evidence.yaml` (checked with `python3 scripts/requirements/apply_status.py --check` → `status-evidence.yaml OK (102 entries)`), applied to `requirements.yaml` and the traceability matrix by the lead. |
| Scope | All 82 requirements with `phase: P1` and `priority: must` in `docs/requirements/requirements.yaml` (register total unchanged: 394) |

## Update at the P1 gate (lead, 2026-09-30) — closes QA-P1R-02 / QA-P1R-03

**Source of truth:** the register (`docs/requirements/requirements.yaml`, generated from
`docs/requirements/status-evidence.yaml`). The tables below this section were written at `7959b44` and are kept as
history. Where they disagree with the register, the register wins.

**Register counts for the 82 P1 musts at the gate revision:** Tested **58** · Implemented **22** · Deferred **2** ·
Planned 0.

Changes since `7959b44`:
- **REQ-SRC-002 → Tested.**
  - `packages/db/scripts/validate-templates.mjs` now checks that each of the 7 reference heading claims (CLM-002..008)
    maps to at least one DC template workstream, and that every mapped WBS activity belongs to a mapped workstream.
  - The mapping is in `packages/db/seed/source-maps/dc-carveout.v1.json` (status proposed).
  - A negative probe fails the validator.
- **REQ-ARC-011 → Tested.**
  - `apps/api/scripts/check-module-boundaries.mjs` runs in the API lint (CI static job). It checks that cross-module
    imports go only through published surfaces and that the module graph is acyclic.
  - A negative probe fails the check.
  - Variance: this is a dependency-free checker instead of dependency-cruiser.
- **Tested earlier through the P1 closure and security fixes:** REQ-ARC-005 and the P1 closure tests (see register
  evidence).

The 24 P1 musts that are not Tested:

| ID | Status | Disposition | Owner |
|---|---|---|---|
| REQ-UX-003, REQ-ARC-001, REQ-ARC-013, REQ-AGT-011, REQ-PHS-003, REQ-PHS-011, REQ-PHS-012, REQ-PHS-013 | Implemented | Close at the P1 gate by review (see `docs/phases/P1-gate-report.json`) | P1 gate reviewers / delivery-orchestrator |
| REQ-SRC-005, REQ-SRC-007 | Implemented | Re-phased to P2 (source register fields; evidence in the P2 disposition) | backend-data-engineer (documents) |
| REQ-SRC-006 | Implemented | UT re-phased to P2; data-quality view to P6 | backend-data-engineer; integration-reporting-engineer |
| REQ-WS-002 | Implemented | Re-phased to P2 (with REQ-WS-003) | carveout-domain-analyst |
| REQ-UX-001 | Implemented | Server explanations are translated (QA-P1-14). The remaining English (refusal detail text, audit action codes, demo seed text) is re-phased to P6 (QA-P1R-05) | ux-frontend-engineer |
| REQ-PHS-001 | Implemented | Re-phased to P2 | qa-test-engineer |
| REQ-PLT-001, REQ-PLT-007, REQ-ENT-007, REQ-ENT-008, REQ-SET-005 | Implemented | Re-phased to P6 | backend / integration-reporting engineers |
| REQ-UX-019 | Implemented | Templates tab re-phased to P6; users, permissions, identity and E2E to P7 | ux-frontend-engineer |
| REQ-ARC-012 | Implemented | Re-phased to P7 | devops-platform-engineer |
| REQ-SEC-010 | Implemented | AI unit tests re-phased to P5; BI and integration accounts to P6 | ai-runtime-engineer; integration-reporting-engineer |
| REQ-ENT-009 | Deferred | Deferred to P6 | backend-data-engineer (project-config) |
| REQ-SET-009 | Deferred | Deferred to P3 | ux-frontend-engineer (carve-out UI) |

## Evidence baseline

- **CI:** GitHub Actions `transformation-hub-ci` run 8, id **36645986422**, on revision **7959b44**: all jobs green (static incl. fresh-checkout typecheck/lint and `apply_status.py --check`, unit, API integration against PostgreSQL 16, web build + private-mode egress scan, container images + image SBOM + grype, OpenAPI, licence policy, pnpm audit, source SBOM, Helm/kubeconform/compose/shellcheck, backup/restore drill, Playwright e2e with 24 tests against a production web build). This result was reported by the lead; I did not re-query GitHub (no `gh` CLI here).
- **E2E, local:** 24/24 at `4c70d05` (`docs/test-evidence/e2e-p1-p2-run.txt`).
- **Rule applied:** `Tested` only when an automated test that exercises the stated acceptance test (AT) exists and ran green. Partial coverage stays `Implemented`, with the missing part named. REVIEW-type ATs close with a reviewer's confirmation at the gate.

## Summary

| Final status | Count |
|---|---|
| Tested | 33 |
| Implemented | 47 |
| Deferred | 2 (REQ-ENT-009 → P6, REQ-SET-009 → P3) |
| Planned | 0 |

_Update (lead, 2026-09-30): REQ-ARC-005 closed in P1 — S3-compatible adapter + shared contract test (`storage-contract.spec.ts`); it is no longer re-phased to P7._

Of the 49 requirements that are not `Tested`:
- **33 stay in P1.** 8 close at the gate through review or the gate report (UX-003, ARC-001, ARC-013, AGT-011, PHS-003, PHS-011, PHS-012, PHS-013). 25 need a small test, check or CI job before the gate.
- **16 are re-phased or deferred.**

## Table (all 82 P1 musts)

"Disposition" is one of the following:
- **Done:** Tested.
- **Close before P1 gate:** the named test, check or CI job must exist and run green before PASS.
- **Close at P1 gate:** review or gate report.
- **Re-phase to Pn / Deferred:** the requirement stays in scope and is verified at that phase's gate.

| ID | Title | Final status | Evidence (short) | Gap | Disposition | Owner | Reason |
|---|---|---|---|---|---|---|---|
| REQ-PLT-001 | Configurable platform working name | Implemented | HUB_APP_NAME runtime setting (web + API); bilingual default name | No Platform-Admin branding setting (persisted, audited); AT has no test | Re-phase to P6 | backend-data-engineer + ux-frontend-engineer | Admin-editable settings belong to the P6 configuration module; the deployment setting already avoids code changes |
| REQ-PLT-002 | Working application, not mockups or browser-local data | Implemented | PostgreSQL behind authorized API; QA manual restart (P1-qa-review §1.8); restore drill green in CI | No automated restart IT (API, worker, DB); AT-30 needs reporting | Close before P1 gate; AT-30 part to P8 | qa-test-engineer | Restart IT is small (re-create the app/worker around the same DB); AT-30 is verified with REQ-PLT-003 (P8) |
| REQ-PLT-004 | No fabricated business facts anywhere | Implemented | Templates validated for no names/dates/amounts; demo personas are role labels; ai at-28 green in CI | No UT on production bootstrap content | Close before P1 gate (with REQ-SET-006) | backend-data-engineer | One bootstrap IT covers PLT-004, SET-006 and SET-008 |
| REQ-PLT-005 | Every primary action backed end to end | Implemented | Boot-time contract check (contract-check.ts) on every integration boot | No negative UT that the check fails for an unbound handler; AT-30 | Close before P1 gate; AT-30 part to P8 | solution-architect | Small UT with a dummy controller |
| REQ-PLT-006 | Honest implementation and integration status | Tested | ai-settings-ops (mock = Simulated), at-22 (Not configured), at-25 (S3 Not configured), oidc (not_configured) | — | Done | — | — |
| REQ-PLT-007 | No external publication or real messages without authorization | Implemented | No outbound channel exists; delivery ledger | Email/Teams/SMS adapters not built, so the UT cannot run; AT-22 runtime proof | Re-phase to P6 | integration-reporting-engineer | Notification/integration adapters are P6 module shells |
| REQ-SRC-002 | Map reference headings to template scope | Implemented | DC template + validator | No check that each reference heading links to a workstream | Close before P1 gate | carveout-domain-analyst | Validator extension over existing template content |
| REQ-SRC-003 | Historical statuses kept as source-reported values only | Tested | documents at-01 (refused, nothing changes; never applied to task); D documents.test; e2e p2-documents (c) | — | Done | — | — |
| REQ-SRC-004 | Unclear names, dates and figures remain unverified | Implemented | documents at-01 (CLM-010 unknown, nothing confirmed); contract default unknown | No test that a claim without status / low confidence is stored as unknown | Close before P1 gate | qa-test-engineer | One API assertion |
| REQ-SRC-005 | Source Register identification fields | Implemented | source_record fields; server-side SHA-256 (at-27, at-25) | Duplicate-upload detection not implemented | Re-phase to P2 | backend-data-engineer (documents) | Feature gap in the documents module, gated in P2 |
| REQ-SRC-006 | Separate dates and supporting location per claim | Implemented | Separate report/as-of/extraction dates; location mandatory (at-01) | No UT location-before-confirm; no data-quality flag for missing as-of date | Re-phase: UT to P2, data-quality view to P6 | backend-data-engineer; integration-reporting-engineer | Data-quality views are REQ-RPT-006 (P6) |
| REQ-SRC-007 | Claim value, confidence, review and conflict tracking | Implemented | Claim fields; review command (at-01); AT-14 at evidence level (documents at-14) | Claim-level conflict marks only the reviewed claim; no UT | Re-phase to P2 | backend-data-engineer (documents) | Behaviour change in the documents module, gated in P2 |
| REQ-SRC-008 | Verification status vocabulary enforced | Implemented | DB enum + contract enum; at-01 (confirmed refused at creation) | No out-of-vocabulary test against API and DB | Close before P1 gate | qa-test-engineer | Two assertions |
| REQ-ENT-001 | First template: DC Carve-out to NewCo to JV | Tested | P1 projects-templates-audit AT-02; validator in CI | — | Done | — | — |
| REQ-ENT-002 | Enterprise hierarchy | Implemented | Hierarchy tables + FKs; org RLS hides foreign programs | No cross-org program test; portfolio/program creation APIs absent | Close before P1 gate (test); creation to P6 | backend-data-engineer | The test is small; creation screens belong with P6 administration |
| REQ-ENT-003 | Legal entities separate from projects | Tested | P1 traceability-p1 (one entity, two projects) | — | Done | — | — |
| REQ-ENT-005 | Per-project template and multiple template types | Tested | P1 projects-templates-audit AT-02 | — | Done | — | — |
| REQ-ENT-006 | Add projects through administration only | Tested | P1 projects-templates-audit; e2e qa-p1-review wizard en/ar | — | Done | — | — |
| REQ-ENT-007 | Template-configurable phases, gates, fields, forms, workflows and KPIs | Implemented | Versioned template definition; validator checks references (CI) | Custom fields/forms not modelled; no authoring API; no negative test | Re-phase to P6 | backend-data-engineer (project-config) | Template authoring is the P6 configuration module (with ENT-009) |
| REQ-ENT-008 | Template versioning with stable project binding | Implemented | Published versions immutable (templates-loader); project pins template_version_id | No UT: publishing a new version leaves projects on the old one; AT-26 | Re-phase to P6 | backend-data-engineer (project-config) | Publishing workflow and AT-26 arrive with ENT-009 in P6 |
| REQ-ENT-009 | Template upgrade requires preview and approval | Deferred | D rules.test AT-26 diff; project_template_migration table (schema only) | Preview/approve workflow not built | Deferred to P6 | backend-data-engineer (project-config) | Lead decision; projects stay pinned meanwhile (ENT-008) |
| REQ-ENT-011 | Multi-level role scopes | Tested | planning acceptance-and-access (workstream lead); arch-rereview permission reach | — | Done | — | — |
| REQ-WS-001 | Twelve editable initial workstreams | Tested | P1 projects-templates-audit (12 workstreams) | — | Done | — | — |
| REQ-WS-002 | Minimum scope per workstream seeded | Implemented | Validator: >=1 proposed activity per workstream | Per-element minimum-scope coverage not checked (QA-P1-10) | Re-phase to P2 (with REQ-WS-003) | carveout-domain-analyst | Needs an element-to-activity map authored by the domain analyst |
| REQ-WS-004 | Proposed WBS of at least 80 useful activities | Tested | Validator (113 activities); AT-02 (>=80); P0 domain review | — | Done | — | — |
| REQ-WS-005 | WBS activity attributes | Tested | Validator field set (CI unit job) | — | Done | — | — |
| REQ-WS-006 | No invented dates or people in WBS | Tested | Validator (no dates/amounts); AT-02 (no planned dates) | — | Done | — | — |
| REQ-WS-007 | Initial activity status Draft/Unverified | Tested | AT-02 test: all tasks draft, verification proposed | — | Done | — | — |
| REQ-UX-001 | Switchable Arabic RTL and English LTR | Implemented | e2e p1-smoke (b), qa-p1-review ar wizard, p2-documents (d) | Server-provided names stay English in Arabic UI (QA-P1-14) | Re-phase to P2 | ux-frontend-engineer + backend-data-engineer | API must return {en, ar} for template-derived names; Low finding QA-P1-14 |
| REQ-UX-002 | i18n for UI text, English technical names | Implemented | check-i18n.mjs in pnpm lint (key parity, placeholders, enums) | Nothing fails on a hard-coded UI string | Close before P1 gate | ux-frontend-engineer | Add a JSX literal scan to the i18n check |
| REQ-UX-003 | Corporate blue/white theme, no fabricated logo | Implemented | Theme tokens (globals.css); README: no logo; repo scan: no image/logo asset | REVIEW AT not yet performed by a reviewer | Close at P1 gate (review / gate report) | P1 gate reviewer | REVIEW-type AT |
| REQ-UX-004 | Screen 1: Portfolio Home | Tested | e2e p1-smoke (a)(c), qa-p1-review; P1 isolation "lists only authorized projects"; AT-02 | — | Done | — | — |
| REQ-UX-019 | Screen 16a: Administration (templates, users, permissions, identity) | Implemented | Admin users list; members grant/revoke; admin user API tested | No user-creation UI; templates/permissions/identity tabs not built; no E2E | Re-phase: templates tab to P6; users/permissions/identity + E2E to P7 | ux-frontend-engineer | Tabs already labelled P6/P7 in the UI; IdP-driven provisioning is P7 |
| REQ-UX-028 | Demo data clearly labelled | Implemented | Badge on cards/header/records; e2e p1-smoke (a), qa-p1-review (list) | No E2E asserts the badge on the demo project detail view | Close before P1 gate | ux-frontend-engineer | One assertion in p1-smoke (a) |
| REQ-ARC-001 | TypeScript monorepo with Next.js and NestJS | Implemented | Monorepo; ADR-0001/0002 (in P0 architecture review scope) | REVIEW AT to be confirmed | Close at P1 gate (review / gate report) | P1 gate reviewer | REVIEW-type AT |
| REQ-ARC-002 | PostgreSQL source of truth with constraints; optional pgvector | Tested | Migrations applied to an empty schema on every run (CI); FK/constraint tests | — | Done | — | — |
| REQ-ARC-003 | One documented ORM; isolation not assumed from ORM | Tested | ADR-0003 (P0 architecture review); RLS tests | — | Done | — | — |
| REQ-ARC-004 | Separate worker for scheduling, reporting and AI | Implemented | worker.ts + platform/jobs; job lease/dead-letter tests (in-process); CI e2e starts dist/worker.js | No test asserts the separate worker process consumes the outbox | Close before P1 gate | backend-data-engineer | IT that spawns dist/worker.js and waits for an outbox event to be processed |
| REQ-ARC-005 | Object storage and file services via adapters | Tested | documents storage-contract.spec.ts: one contract suite over the local FS and S3-compatible adapters (in-process S3 server verifying SigV4; signer checked against botocore vectors) | Mobily object store, scanning/PDF/OCR services Not configured | Closed in P1 (2026-09-30, lead) | — | Real S3 endpoint needs Mobily input (MQ-11) |
| REQ-ARC-007 | OpenAPI, schemas and safe generated client | Implemented | OpenAPI 3.1 generated from contracts (CI job green); typed web client | No UT that every route is covered with converted schemas; spec not served | Close before P1 gate | solution-architect | Small UT over the generator output |
| REQ-ARC-008 | Unit, integration, E2E and accessibility testing | Implemented | CI run 36645986422: unit, integration, 24 Playwright e2e green | No axe checks | Close before P1 gate | ux-frontend-engineer + devops-platform-engineer | Axe checks in progress |
| REQ-ARC-010 | Pinned supported versions and licence checks | Tested | CI licence policy job + frozen-lockfile installs green; ADR-0002 | — | Done | — | — |
| REQ-ARC-011 | Modular monolith plus worker | Implemented | ADR-0001; module folders | No dependency-cruiser (or equivalent) boundary rule | Close before P1 gate | solution-architect | Boundaries matter now that P2/P3 modules are merged |
| REQ-ARC-012 | No external SaaS for core platform services | Implemented | Internal core services; AI egress test; static egress scan green in CI | No full-stack run with outbound network blocked | Re-phase to P7 | devops-platform-engineer | Private-mode runtime proof is REQ-DEP-003/014 (P7) |
| REQ-ARC-013 | Core module set | Implemented | apps/api/src/modules/*; module-guide.md | REVIEW AT to be confirmed | Close at P1 gate (review / gate report) | P1 gate reviewer | REVIEW-type AT |
| REQ-ARC-014 | Mandatory mutation flow | Implemented | Denied/rejected mutations audited, no data change (isolation-and-auth, documents at-03, at-01) | No unauthenticated-mutation 401 test; no no-outbox-on-failure assertion | Close before P1 gate | qa-test-engineer | Downgraded from Tested; two small ITs |
| REQ-ARC-015 | Frontend never touches DB or LLM secrets; MCP optional | Implemented | Same-origin proxy; no DB/LLM secrets in client | No secret scan of the build output (egress scan checks http(s) URLs only) | Close before P1 gate (with REQ-SEC-012) | devops-platform-engineer | Same CI secret-scan job |
| REQ-DAT-002 | Project scoping and cross-project link prevention | Tested | architecture-hardening ARCH-01 (DB rejects cross-project link) | — | Done | — | — |
| REQ-DAT-003 | Decimal money with currency, units and periods | Tested | D rules.test AT-29 + float rejection; numeric(20,4) columns | — | Done | — | — |
| REQ-DAT-005 | Optimistic concurrency | Tested | P1 AT-16; planning at-16 (two approvers, one 409) | — | Done | — | — |
| REQ-DAT-006 | Append-only audit with full context | Tested | Audit trail tests (before/after, correlation id, UPDATE/DELETE rejected) | — | Done | — | — |
| REQ-DAT-008 | Honest tamper-evidence claims | Implemented | ADR-0014; tail-truncation detection; chain verifies | No test that the verifier detects a modified row | Close before P1 gate | qa-test-engineer | Downgraded from Tested; one IT in a rolled-back transaction |
| REQ-DAT-009 | Soft deletion | Tested | traceability-p1 (soft-deleted document out of list/total/detail); at-27 | — | Done | — | — |
| REQ-DAT-012 | Explicit attachments, exports and access; no public links | Implemented | Download audited, anonymous 401 (at-27); hidden downloads 404 (at-03) | Revoked-session download not asserted; AT variance; exports | Close before P1 gate; exports to P6 | qa-test-engineer; integration-reporting-engineer | Variance to be accepted in the gate report |
| REQ-DAT-015 | API versioning, pagination and filtering | Tested | qa-p1-sec016 paging limits | — | Done | — | — |
| REQ-DAT-017 | Validation and secret-free error logs | Implemented | Validation 400 problem+json; errors.ts/audit.service.ts redaction code | No test for no stack trace in errors or cookie redaction in logs | Close before P1 gate | backend-data-engineer | Downgraded from Tested; small UTs |
| REQ-SEC-001 | Proposed role catalogue | Tested | policy-matrix.json; D policy.test | — | Done | — | — |
| REQ-SEC-002 | Infrastructure administration separate from content access | Tested | isolation-and-auth: platform admin sees no project content (404) | — | Done | — | — |
| REQ-SEC-003 | RBAC plus ABAC, deny by default | Tested | D policy.test; isolation-and-auth | — | Done | — | — |
| REQ-SEC-006 | Isolation in APIs and database row policies | Tested | isolation-and-auth (API 404, RLS raw query); architecture-hardening | — | Done | — | — |
| REQ-SEC-009 | Session expiry and revocation | Tested | isolation-and-auth (logout, deactivation, role revocation) | — | Done | — | — |
| REQ-SEC-010 | Separate service accounts with least privilege | Implemented | Service principal allowlist; AI refuses approve/waive (ai at-17) | No UT on the AI service identity permission set; BI/integration accounts not built | Re-phase: AI UT to P5, BI/integration accounts to P6 | ai-runtime-engineer; integration-reporting-engineer | Accounts arrive with their modules |
| REQ-SEC-012 | Secrets management and rotation | Implemented | docs/deployment/secrets.md; runtime injection; validate-deploy/backup refuse secrets | No CI secret scan (repo, web bundle, test reports); rotation not exercised | Close before P1 gate (scan); rotation to P7 | devops-platform-engineer | The AT is the CI secret scan |
| REQ-SEC-016 | CSRF, XSS, injection and IDOR protection | Tested | CSRF + IDOR tests; qa-p1-sec016 injection/XSS; e2e XSS inert | — | Done | — | — |
| REQ-SEC-024 | Development identity isolated, no default passwords | Implemented | Config rejects demo mode in production; SEC-P1-02 (demo-users 404 in standard mode) | POST /auth/demo-login 404 outside demo mode not asserted; AT variance | Close before P1 gate | qa-test-engineer | One assertion |
| REQ-DEP-002 | Mode: Local Development | Implemented | Documented commands; CI e2e job starts API/worker/web with PostgreSQL only | CI uses CI-specific steps, not the documented local commands; no local containers started | Close before P1 gate (with REQ-DEP-007) | devops-platform-engineer | A CI job running the documented compose commands closes both |
| REQ-DEP-007 | Docker Compose for development/evaluation | Implemented | compose.dev.yml; docker compose config validated in CI | compose up NOT EXECUTED anywhere | Close before P1 gate (CI compose-up job) | devops-platform-engineer | Images now build green in CI, so compose up --wait with health checks is feasible there |
| REQ-DEP-010 | Secret-free env examples and unsafe-config rejection | Tested | oidc-sso: unsafe production configuration refused by loadConfig | — | Done | — | — |
| REQ-DEP-022 | Continuous integration pipeline | Tested | CI run 36645986422 (7959b44), all jobs green | — | Done | — | — |
| REQ-AGT-011 | Single owner for shared contracts, migrations and lockfiles | Implemented | module-guide.md File ownership; lead regenerates the migration on merge | REVIEW AT; variance (see below) | Close at P1 gate (review / gate report) | delivery-orchestrator + P1 gate reviewer | REVIEW-type AT |
| REQ-PHS-001 | Sequential phases with early end-to-end journey | Implemented | Sequential phases; create-project and decision E2Es | No single create, decision, report journey E2E | Re-phase to P2 | qa-test-engineer | The AT itself is due by end of P2; AT-30 with REQ-PLT-003 (P8) |
| REQ-PHS-003 | P1 exit: persistence, isolation and denied access | Implemented | P1 QA + security reviews; AT-02, AT-03 tests | Gate report not written | Close at P1 gate (review / gate report) | delivery-orchestrator | Closes with docs/phases/P1-gate-report.json |
| REQ-PHS-011 | Scope and tests before implementation; runnable increments | Implemented | Register + backlog P1 epics; CLAUDE.md Phase gates | Variance: P1 scope committed with the first P1 code | Close at P1 gate (review / gate report) | delivery-orchestrator | Record the variance in the gate report |
| REQ-PHS-012 | No pass with open Critical/High or unexecuted verification | Implemented | Independent P1 reviews; Phase gates rule | Gate report not written | Close at P1 gate (review / gate report) | delivery-orchestrator | Closes with the gate report (open_findings) |
| REQ-PHS-013 | Lower-severity issues recorded; mandatory scope retained | Implemented | 394 requirements at P0 and now; this file | Gate report not written | Close at P1 gate (review / gate report) | delivery-orchestrator | Closes with the gate report (requirement count) |
| REQ-PHS-024 | Code deliverables | Tested | CI run 36645986422: clean checkout builds, migrates, seeds, tests green | — | Done | — | — |
| REQ-SET-001 | Demo sandbox DC project | Implemented | Seed through real services in every setup (CI); governance seed rows is_demo | Idempotency and all-records is_demo not asserted | Close before P1 gate | backend-data-engineer | Downgraded from Tested; run the seed twice and count |
| REQ-SET-003 | Second transformation project for isolation tests | Tested | isolation-and-auth (project B isolation) | — | Done | — | — |
| REQ-SET-005 | Demo data labelled and excluded from actual reporting | Implemented | is_demo flags; demo badge | Reporting/KPI/BI exclusion not built | Re-phase to P6 | integration-reporting-engineer | Reporting is P6; see also QA observation on demo-persona projects being is_demo = false |
| REQ-SET-006 | Production bootstrap without invented content | Implemented | apps/api/src/cli/bootstrap.ts (refuses demo mode / demo users) | No IT runs bootstrap on an empty DB and checks its output | Close before P1 gate | backend-data-engineer | One IT (with PLT-004, SET-008) |
| REQ-SET-008 | No default passwords or backdoor accounts | Implemented | No passwords (ADR-0005); IdP-bound first admin | No repo credential scan; AT variance (no one-time token) | Close before P1 gate (via SEC-012 scan + SET-006 IT) | devops-platform-engineer + backend-data-engineer | Covered by the same two additions |
| REQ-SET-009 | Wizard step 1: program, objective, parties and sites | Deferred | Wizard captures program and objective | No parties/sites; no persisted, resumable step 1 | Deferred to P3 | carve-out UI (ux-frontend-engineer) | Parties and sites come from the P3 registers (lead decision) |

## Work to close before the P1 gate (25 items, by owner)

- **qa-test-engineer:**
  - PLT-002: API and worker restart IT.
  - SRC-004: a claim with no status is stored as unknown.
  - SRC-008: an out-of-vocabulary status is rejected by the API and by the DB.
  - ARC-014: a mutation without a session returns 401, and a failed business rule writes no outbox row.
  - DAT-008: the verifier detects a modified audit row.
  - DAT-012: a download with a revoked session is rejected.
  - SEC-024: `POST /auth/demo-login` returns 404 outside demo mode.
- **backend-data-engineer:**
  - PLT-004, SET-006, SET-008: one bootstrap IT on an empty DB.
  - ENT-002: a project cannot reference a program of another organization.
  - ARC-004: the separate worker process consumes the outbox.
  - DAT-017: error responses carry no stack trace, and logs redact the session cookie.
  - SET-001: the seed is idempotent and every seeded record has `is_demo`.
- **solution-architect:**
  - PLT-005: the contract check fails for an unbound handler (negative UT).
  - ARC-007: the OpenAPI output covers every registered route.
  - ARC-011: a module-boundary import rule.
- **ux-frontend-engineer:**
  - UX-002: a hard-coded UI string check.
  - UX-028: a Demo badge assertion on the detail view.
  - ARC-008: axe checks (in progress; devops wires them into CI).
- **carveout-domain-analyst:** SRC-002: every reference heading maps to a workstream.
- **devops-platform-engineer:**
  - SEC-012, ARC-015, SET-008: a CI secret scan over the repository, the web bundle and test reports.
  - DEP-002, DEP-007: a CI job that runs the documented `docker compose` commands with `up --wait` and health checks.

## Re-phased / deferred (16)

| Target | Requirements |
|---|---|
| P2 | SRC-005 (duplicate upload), SRC-006 (location UT; data-quality view → P6), SRC-007 (claim conflict pair), WS-002 (per-element scope, with WS-003), UX-001 (bilingual server strings, QA-P1-14), PHS-001 (thin journey E2E, due by end of P2) |
| P3 | SET-009 (Deferred; wizard step 1 parties/sites/resume) |
| P5 / P6 | SEC-010 (AI service identity UT → P5; BI/integration accounts → P6) |
| P6 | PLT-001 (admin branding), PLT-007 (channel adapters), ENT-007 (template authoring, fields/forms), ENT-008 (publish + AT-26), ENT-009 (Deferred; upgrade preview/approval), SET-005 (reporting exclusion) |
| P6 / P7 | UX-019 (templates tab → P6; users/permissions/identity + E2E → P7) |
| P7 | ARC-012 (full stack with outbound blocked) |

Partial re-phases inside "close before gate" rows:
- ENT-002: portfolio/program creation → P6.
- DAT-012: exports → P6.
- SEC-012: rotation drill → P7.
- PLT-002, PLT-005: AT-30 → P8 (REQ-PLT-003).

## Changes to existing overlay entries (2026-09-30)

- **Downgraded Tested → Implemented** (the cited evidence did not exercise the stated AT):
  - REQ-ARC-014: no unauthenticated-mutation 401 test; no no-outbox-on-failure assertion.
  - REQ-DAT-008: the tamper test deletes a row; a modified row is not tested.
  - REQ-DAT-017: nothing asserts no stack trace or cookie redaction.
  - REQ-SET-001: the seed runs once, so idempotency and all-demo are not asserted.
- **Upgraded Implemented → Tested** (the AT is exercised by tests that ran green):
  - REQ-SEC-016: CSRF, IDOR, injection and XSS tests are committed, which closes P0 carry-over QA-08.
  - REQ-DEP-010: `loadConfig` refuses unsafe production settings.
  - REQ-PLT-006: the mock AI provider reports Simulated, and unconfigured adapters report Not configured.
- **Evidence corrected:** REQ-ENT-011. The earlier citations covered project and room scope. It now cites the planning workstream-lead test.
- **Evidence extended:**
  - REQ-ENT-006: wizard E2E.
  - REQ-DAT-005: baseline approval 409.
  - REQ-SEC-009: role revocation.
- **Formatting fixed:** WS-007, ARC-002, DAT-003, ARC-001 and ARC-013 had evidence items split at commas by the YAML flow syntax.

## AT variances (to be recorded in the P1 gate report)

- **REQ-DAT-009:** tasks are never deleted; they are cancelled and stay visible. Soft deletion applies to documents, which is what is tested.
- **REQ-SRC-003:** the reference image was not available, so no import ran. The historical claims were recorded from the master prompt text (extraction NOT performed). The invariant is enforced on claims however they enter.
- **REQ-ARC-014:** rejected and denied attempts are deliberately audited (outcome `rejected`/`denied`). The AT should read "no business change and no outbox rows" rather than "no audit rows".
- **REQ-DAT-012:** no signed download URL is issued. Downloads are streamed after authorization on each request, so there is no URL that could expire. The equivalent check is "a download without a valid session is refused" (anonymous → 401 is tested).
- **REQ-SEC-024:** no credentials exist at all. Demo login is credential-less and exists only in demo mode. "Seed users have random generated credentials" therefore does not apply.
- **REQ-SET-008:** the first administrator is bound to an IdP identity (no password), instead of the one-time token the AT assumes.
- **REQ-WS-007:** instantiated tasks are status `draft` with verification `proposed`; the AT says "Draft/Unverified".
- **REQ-SEC-002:** tested as "platform admin gets 404 for the whole project", which is a superset of the AT's "Legal Restricted document".
- **REQ-PLT-001:** the web default name is "Transformation & Transactions Hub". The API default and the specification's working name include "Mobily".
- **REQ-PHS-011:** the P1 scope (register and backlog) was committed together with the first P1 code (`e2daae7`), after the groundwork commit `d9f6364`. It did not precede implementation.
- **REQ-AGT-011:** module branches regenerated the single pre-release migration locally (e.g. `175bad3`, `40015f4`). The lead regenerated it from the merged schema on every merge (e.g. `08ee5f3`, `0d3232d`). Git author is "Claude" for all commits, so git history alone cannot show which agent authored a migration.

## Borderline Tested entries (left Tested; reviewer to confirm)

- **REQ-ARC-002:** "repeatable" is read as "reproducible on an empty database every run". A second migrate run on an already-migrated database is not asserted.
- **REQ-WS-005:** the validator checks every activity has acceptance criteria and a gate link, but it has never been run against a failing template.
- **REQ-ARC-003:** the AT is REVIEW-type. It is satisfied by the P0 architecture review (ADR-0003 in scope) plus the RLS tests.
- **REQ-ENT-003, REQ-DAT-009:** these cite `traceability-p1.spec.ts`, added after `30f58a2`. It ran green in CI run 36645986422.
