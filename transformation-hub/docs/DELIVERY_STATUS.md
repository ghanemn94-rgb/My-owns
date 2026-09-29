# Delivery status

Status vocabulary (spec §1 rule 7): **Implemented** (code exists) · **Tested** (automated tests executed and passing in
this environment) · **Simulated** (mock/demo stand-in, clearly labelled) · **Not configured** (needs Mobily input) ·
**Blocked** (cannot proceed without an external dependency) · **Planned** · **In progress** (being built in a module
branch, not yet merged — not a verification status).

Engineering verification is distinct from Mobily production approval, which requires Mobily infrastructure, security
and business owners (see `docs/assumptions-and-open-questions.md`). Nothing here means "Production Ready".

_Last updated: 2026-09-29 at revision `38f947c`. Per-requirement status with evidence is in
`docs/requirements/requirements-traceability.md` (generated; `scripts/requirements/apply_status.py --check` verifies that
every cited test file and title exists). Counts below are from runs executed at that revision on PostgreSQL 16._

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Specification, requirements (394), PRD, backlog | Implemented | `docs/requirements/`, `docs/PRD.md` | P0 gate PASS (`docs/phases/P0-gate-report.json`) |
| Agent definitions (11) | Implemented | `.claude/agents/` | Executed as subagents in the build session (ADR-0015) |
| Domain rules (state machines, quorum/authority, gates, schedule/CPM, measurement, money, carve-out, readiness, AI authority, policy matrix) | Tested | 233 unit tests (`packages/domain`, 13 files) | Policy matrix kept in sync with `docs/security/access-matrix.md` by a drift test |
| Database schema, migrations, RLS, append-only audit + hash chain, cross-project/org FK guards | Tested | API integration suite (below) | One pre-release migration; post-migrate SQL holds RLS, guards and triggers |
| API integration suite (all modules) | Tested | 437 tests in 50 files (`apps/api/test`: p1, governance, planning, gates, documents, carveout, readiness, ai) | Run on a reset database with the demo seed loaded through the real services |
| Identity: demo login, logout, user admin, account type (internal/external) | Tested | `p1/isolation-and-auth.spec.ts`, `p1/security-p1-fixes.spec.ts` | Demo login exists only in `HUB_MODE=demo`; demo sessions are rejected outside demo mode |
| Enterprise SSO (OIDC) | Tested (against an in-process test IdP) · Not configured (Mobily IdP) | `p1/oidc-sso.spec.ts` | Authorization Code + PKCE, signed ID token, no auto-provisioning; connecting Mobily's IdP needs Q-04 |
| Portfolio: projects from templates, members, workstreams, activity, setup gaps | Tested | `p1/projects-templates-audit.spec.ts`, `p1/arch-rereview-hardening.spec.ts` | AT-02, AT-16, AT-27 |
| Governance (committees, charters, authority matrix, meetings, decisions, votes, recusal, actions) | Tested | `apps/api/test/governance`, e2e `p2-governance.spec.ts` | AT-04, AT-05 |
| Planning (WBS, tasks, milestones, deliverables, dependencies/CPM, baselines, change requests, RAID, status updates, RAG) | Tested | `apps/api/test/planning`, e2e `p2-planning.spec.ts` | AT-15, AT-16 |
| Business gates G0–G7 (criteria, evidence, designated reviewers, waivers, non-waivable, approvals) | Tested | `apps/api/test/gates`, e2e `p2-gates.spec.ts` | AT-04, AT-06, AT-12, AT-13, AT-14 |
| Documents, evidence, source register, claims, partner rooms, legal hold | Tested | `apps/api/test/documents`, e2e `p2-documents.spec.ts` | AT-01, AT-03, AT-14, AT-25, AT-27; malware scanning is an adapter — Not configured (uploads marked unscanned; refused in production unless `HUB_ALLOW_UNSCANNED_FILES`) |
| Carve-out (perimeter, sites, transfers, reconciliation, Day-1 contract positions, agreements, consents) and NewCo (legal entities, incorporation, regulatory register) — backend | Tested | `apps/api/test/carveout` | AT-06, AT-07, AT-08; register edits Legal-only (REQ-AGR-004) |
| Readiness, Day-1 cutover, TSA — backend | Tested | `apps/api/test/readiness` | AT-09, AT-10 |
| Carve-out / NewCo / readiness web screens | In progress | — | P3 UI agents |
| Web client (portfolio, wizard, My Work, committee hub, plan, RAID, gates, documents, admin) | Tested | 24 Playwright tests (`e2e/tests`), run recorded in `docs/test-evidence/e2e-p1-p2-run.txt`; screenshots `e2e/screenshots/` | ar RTL / en LTR; axe accessibility checks In progress (REQ-ARC-008) |
| AI runtime PM (knowledge ingestion, ACL-aware retrieval, typed tools, proposals/approval binding, kill switch, budgets) | Tested (backend, mock provider) · Not configured (model endpoint) | `apps/api/test/ai` (AT-17..AT-22, AT-28) | Default mode Off; the mock provider is Simulated and labelled; no model is assumed to be deployable on Mobily infrastructure. Web UI Planned |
| Finance, JV / due diligence / CPs | Planned | — | P4 |
| Reporting, imports, integrations, notifications delivery | Planned | — | P6; all external channels disabled |
| Deployment: Dockerfiles, Compose, Helm chart, private-mode configs, backup/restore scripts | Implemented · restore drill Tested | `deploy/`, `scripts/ops/`; CI jobs "Backup/restore drill" and "Helm / kubeconform / compose / shellcheck" green on GitHub run 36643014027 | Images built only in CI (no Docker daemon here); Helm install NOT EXECUTED |
| CI (`.github/workflows/transformation-hub-ci.yml`) | Implemented | GitHub Actions runs 1–6 | Run 5 (30f58a2): static, unit, API integration, OpenAPI, licence, audit, SBOM, Helm, restore drill green; web egress scan, image build and e2e red → fixed in 38f947c, awaiting a green run |
| Production approval by Mobily | Not configured | — | Requires Q-01..Q-14 answers |

## Environmental blockers
- Reference image / Excel not provided → image extraction not performed.
- No Docker daemon here → images are built only in CI; Helm install and Compose `up` not executed locally.
- No enterprise IdP, SMTP, Teams, SIEM, malware scanner or approved model endpoint → those adapters remain Not configured /
  Simulated.
