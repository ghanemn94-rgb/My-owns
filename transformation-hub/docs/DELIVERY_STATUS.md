# Delivery status

Status vocabulary (spec §1 rule 7): **Implemented** (code exists) · **Tested** (automated tests executed and passing in
this environment) · **Simulated** (mock/demo stand-in, clearly labelled) · **Not configured** (needs Mobily input) ·
**Blocked** (cannot proceed without an external dependency) · **Planned** · **In progress** (being built in a module
branch, not yet merged — not a verification status).

Engineering verification is distinct from Mobily production approval, which requires Mobily infrastructure, security
and business owners (see `docs/assumptions-and-open-questions.md`).

_Last updated: 2026-09-29 (P1 foundation checkpoint). Per-requirement status (Planned / Implemented / Tested …) with evidence is in `docs/requirements/requirements-traceability.md`; statuses here are summaries of that matrix._

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Specification, requirements (394), PRD, backlog | Implemented | `docs/requirements/`, `docs/PRD.md` | P0 reviews in `docs/reviews/` |
| Agent definitions (11) | Implemented | `.claude/agents/` | Executed as general-purpose subagents in the build session (ADR-0015) |
| Domain rules (state machines, quorum/authority, gates, schedule/CPM, measurement, money, carve-out, AI authority, policy) | Tested | 92 unit tests (`packages/domain`) | |
| Database schema, migrations, RLS, append-only audit + hash chain | Tested | integration tests `apps/api/test/p1` | 104 tables; 5 infrastructure tables exempt from RLS by design |
| API platform (sessions, CSRF, scope, policy, audit, outbox, jobs, errors, contracts, OpenAPI) | Tested (core) | 70 integration tests (`apps/api/test/p1`) | Includes P0 architecture re-review regressions |
| Identity: demo login, logout, user admin | Tested | `isolation-and-auth.spec.ts` | Demo login exists only in `HUB_MODE=demo` |
| Enterprise SSO (OIDC) | Tested (against an in-process test IdP) · Not configured (Mobily IdP) | `oidc-sso.spec.ts` (14 tests) | Authorization Code + PKCE, signed ID token verified, no auto-provisioning; connecting Mobily's IdP needs Q-04 |
| Portfolio: projects from templates, members, workstreams, activity | Tested | `projects-templates-audit.spec.ts` | AT-02, AT-16 (project), AT-27 (DB trigger) |
| Web client (P1 foundation) | Tested (smoke) | 6 Playwright tests `e2e/tests/p1-smoke.spec.ts`; screenshots `e2e/screenshots/` | ar RTL / en LTR; later-phase screens show NotImplementedYet |
| Governance, planning, gates, documents | In progress | — | P2 module agents |
| Carve-out, NewCo, readiness/TSA, finance, JV | Planned | — | P3/P4 |
| AI runtime PM | Planned | — | P5; default mode Off |
| Reporting, imports, integrations | Planned | — | P6; all external channels disabled |
| Deployment (Docker/Helm/runbooks, backup/restore) | Planned | — | P7; Docker daemon unavailable in build env |
| Production approval by Mobily | Not configured | — | Requires Q-01..Q-14 answers |

## Environmental blockers
- Reference image / Excel not provided → image extraction not performed.
- No Docker daemon → images and charts cannot be built here.
- No enterprise IdP, SMTP, Teams, SIEM, or approved model endpoint → those adapters remain Not configured / Simulated.
