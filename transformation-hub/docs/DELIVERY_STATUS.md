# Delivery status

Status vocabulary (spec §1 rule 7): **Implemented** (code exists) · **Tested** (automated tests executed and passing in
this environment) · **Simulated** (mock/demo stand-in, clearly labelled) · **Not configured** (needs Mobily input) ·
**Blocked** (cannot proceed without an external dependency) · **Planned** · **In progress** (being built in a module
branch, not yet merged — not a verification status).

Engineering verification is distinct from Mobily production approval, which requires Mobily infrastructure, security
and business owners (see `docs/assumptions-and-open-questions.md`). Nothing here means "Production Ready".

_Last updated: 2026-09-30 at revision `3735be4` (API suite: 101 files, 856 passed + 2 expected fail; domain 424, contracts 100; full Playwright suite 314 passed in CI run 48 at `5bf274b`). Per-requirement status with evidence is in
`docs/requirements/requirements-traceability.md` (generated; `scripts/requirements/apply_status.py --check` verifies that
every cited test file and title exists). Counts below are from runs executed at that revision on PostgreSQL 16._

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Specification, requirements (394), PRD, backlog | Implemented | `docs/requirements/`, `docs/PRD.md` | P0 gate PASS (`docs/phases/P0-gate-report.json`) |
| Agent definitions (11) | Implemented | `.claude/agents/` | Executed as subagents in the build session (ADR-0015) |
| Domain rules (state machines, quorum/authority, gates, schedule/CPM, measurement, money, carve-out, readiness, finance, JV, AI authority, policy matrix) | Tested | 424 unit tests (`packages/domain`, 21 files); contracts 100 | Policy matrix kept in sync with `docs/security/access-matrix.md` by a drift test |
| Database schema, migrations, RLS, append-only audit + hash chain, cross-project/org FK guards | Tested | API integration suite (below) | One pre-release migration; post-migrate SQL holds RLS, guards and triggers |
| API integration suite (all modules) | Tested | 858 tests in 101 files (856 passed, 2 expected-fail review probes of open Low findings) (`apps/api/test`: p1, governance, planning, gates, documents, carveout, readiness, finance, jv, ai, reviews) | Run on a reset database with the demo seed loaded through the real services; reviewers' DEFECT probes are kept as regression tests once fixed |
| Identity: demo login, logout, user admin, account type (internal/external) | Tested | `p1/isolation-and-auth.spec.ts`, `p1/security-p1-fixes.spec.ts` | Demo login exists only in `HUB_MODE=demo`; demo sessions are rejected outside demo mode |
| Enterprise SSO (OIDC) | Tested (against an in-process test IdP) · Not configured (Mobily IdP) | `p1/oidc-sso.spec.ts` | Authorization Code + PKCE, signed ID token, no auto-provisioning; connecting Mobily's IdP needs Q-04 |
| Portfolio: projects from templates, members, workstreams, activity, setup gaps | Tested | `p1/projects-templates-audit.spec.ts`, `p1/arch-rereview-hardening.spec.ts` | AT-02, AT-16, AT-27 |
| P4 phase gate | PASS WITH CONDITIONS | `docs/phases/P4-gate-report.json` at `d8ea39d` (CI run 64 green) | Engineering gate only; conditions listed there |
| P2 phase gate | PASS WITH CONDITIONS | `docs/phases/P2-gate-report.json` at `bddb637` (CI run 50 green) | Engineering gate only; conditions and Low items listed there |
| Governance (committees, charters, authority matrix, meetings, decisions, votes, recusal, actions) | Tested | `apps/api/test/governance` (incl. `p2-governance-authority.spec.ts`), e2e `p2-governance.spec.ts` | AT-04, AT-05. P2 review fixes merged (tally/quorum, round integrity, evidence-backed external and matrix approvals, requester-only paper edit/submit, conflict declarations before voting, recused chair cannot close voting, one decision backs one record of each kind — decision-use registry). Proposed meeting series from the charter cadence (confirmed by the secretariat), merge / reject screening outcomes, the "Internal electronic approval — not a legally certified signature" label on every approval record, strict PATCH bodies (a status field is refused with 400 on every resource). The external-approval dialog sends a verified evidence link (e2e `p2-web-followups.spec.ts`); the QA final e2e `qa-p2-final-authority-ui.spec.ts` drives the authority rules through the UI |
| Planning (WBS, tasks, milestones, deliverables, dependencies/CPM, baselines, change requests, RAID, status updates, RAG) | Tested | `apps/api/test/planning`, e2e `p2-planning.spec.ts` | AT-15, AT-16. Baseline / change-request approvals are checked against the in-force authority matrix (DOM-P2-03). Cross-project dependencies and prerequisites: API Tested, web screens In progress |
| Business gates G0–G7 (criteria, evidence, designated reviewers, waivers, non-waivable, approvals) | Tested | `apps/api/test/gates`, e2e `p2-gates.spec.ts` | AT-04, AT-06, AT-12, AT-13, AT-14. Gate approvals need a final decision of a type the deciding committee's matrix assigns to the gate (DOM-P2-01). Gate owner / reviewer roles enforced, with a gate-level review step before submission (DOM-P2-16, `apps/api/test/gates/dom-p2-16-gate-roles.spec.ts`, e2e `p2-gates.spec.ts` (d)). One writer of a project's gate state at a time (per-project lock; fixes a deadlock between a gate command and the worker's evaluation refresh — `apps/api/test/gates/gate-lock-order.spec.ts`) |
| Documents, evidence, source register, claims, partner rooms, legal hold | Tested | `apps/api/test/documents`, e2e `p2-documents.spec.ts` | AT-01, AT-03, AT-14, AT-25, AT-27; malware scanning is an adapter — Not configured (uploads marked unscanned; refused in production unless `HUB_ALLOW_UNSCANNED_FILES`) |
| Carve-out (perimeter, sites, transfers, reconciliation, Day-1 contract positions, agreements, consents) and NewCo (legal entities, incorporation, regulatory register) — backend | Tested | `apps/api/test/carveout` | AT-06, AT-07, AT-08; register edits Legal-only (REQ-AGR-004) |
| Readiness, Day-1 cutover, TSA — backend | Tested | `apps/api/test/readiness` | AT-09, AT-10 |
| Carve-out / NewCo / readiness web screens | Tested (e2e flows) | `e2e/tests/p3-carveout.spec.ts`, `p3-readiness.spec.ts`, executed in CI | P3 reviews (domain, security, QA) in progress |
| Web client (portfolio, wizard, My Work, committee hub, plan, RAID, gates, documents, admin) | Tested | Playwright suite incl. `a11y.spec.ts` (axe), executed in CI (e2e job green in run 23, `a471265`); earlier local run in `docs/test-evidence/e2e-p1-p2-run.txt` | ar RTL / en LTR. `pnpm lint` enforces i18n parity and rejects hard-coded UI strings |
| AI runtime PM (knowledge ingestion, ACL-aware retrieval, typed tools, proposals/approval binding, kill switch, budgets) | Tested (backend, mock provider) · Not configured (model endpoint) | `apps/api/test/ai` (AT-17..AT-22, AT-28) | Default mode Off; the mock provider is Simulated and labelled; no model is assumed to be deployable on Mobily infrastructure. Web: AI PM Center (overview, ask, proposals, runs, briefings/detections, settings/kill switch) — e2e `p5-ai.spec.ts`, mock output labelled Simulated, real endpoints shown Not configured |
| Finance (snapshots, budget, models, benefits, KPIs, intercompany reconciliations) and JV / due diligence / CPs (partners, rooms, scenarios, DD, findings, closings, CPs, post-close) — backend | Tested | `apps/api/test/finance`, `apps/api/test/jv` | P4. All figures in the demo are synthetic. Web screens Tested (e2e `p4-finance.spec.ts`, `p4-jv.spec.ts`). P4 domain review FAIL at `40fac20`; all its High findings fixed and merged (decisions relied on through the shared decision-use registry). P4 security and QA reviews in progress |
| Reporting, imports, integrations, notifications delivery | Planned | — | P6; all external channels disabled |
| Deployment: Dockerfiles, Compose, Helm chart, private-mode configs, backup/restore scripts | Implemented · restore drill Tested | `deploy/`, `scripts/ops/`; CI jobs "Backup/restore drill" and "Helm / kubeconform / compose / shellcheck" green on GitHub run 36643014027 | Images built only in CI (no Docker daemon here); Helm install NOT EXECUTED |
| CI (`.github/workflows/transformation-hub-ci.yml`) | Implemented · Tested | GitHub Actions run 32 (`65b53e9`, P1 gate revision) and run 34 (`4fadf91`) fully green | 14 jobs incl. API integration, Playwright e2e against a production build, gitleaks history/tree/bundle/reports, images + SBOM, Helm, restore drill, Compose stack |
| Production approval by Mobily | Not configured | — | Requires Q-01..Q-14 answers |

## Environmental blockers
- Reference image / Excel not provided → image extraction not performed.
- No Docker daemon here → images are built only in CI; Helm install and Compose `up` not executed locally.
- No enterprise IdP, SMTP, Teams, SIEM, malware scanner or approved model endpoint → those adapters remain Not configured /
  Simulated.
