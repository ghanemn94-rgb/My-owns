# Delivery status

Status vocabulary (spec §1 rule 7): **Implemented** (code exists) · **Tested** (automated tests executed and passing in
this environment) · **Simulated** (mock/demo stand-in, clearly labelled) · **Not configured** (needs Mobily input) ·
**Blocked** (cannot proceed without an external dependency) · **Planned**.

Engineering verification is distinct from Mobily production approval, which requires Mobily infrastructure, security
and business owners (see `docs/assumptions-and-open-questions.md`).

_Last updated: 2026-09-29 (P1 foundation checkpoint). This file is updated at every phase gate._

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Specification, requirements (394), PRD, backlog | Implemented | `docs/requirements/`, `docs/PRD.md` | P0 reviews in `docs/reviews/` |
| Agent definitions (11) | Implemented | `.claude/agents/` | Executed as general-purpose subagents in the build session (ADR-0015) |
| Domain rules (state machines, quorum/authority, gates, schedule/CPM, measurement, money, carve-out, AI authority, policy) | Tested | 91 unit tests (`packages/domain`) | |
| Database schema, migrations, RLS, append-only audit + hash chain | Tested | integration tests `apps/api/test/p1` | 103 tables; 5 infrastructure tables exempt from RLS by design |
| API platform (sessions, CSRF, scope, policy, audit, outbox, jobs, errors, contracts, OpenAPI) | Tested (core) | 25 integration tests | Worker job execution tested in later phases |
| Identity: demo login, logout, user admin | Tested | `isolation-and-auth.spec.ts` | Demo login exists only in `HUB_MODE=demo` |
| Enterprise SSO (OIDC) | Not configured | — | Adapter planned P7; needs Mobily IdP (Q-04) |
| Portfolio: projects from templates, members, workstreams, activity | Tested | `projects-templates-audit.spec.ts` | AT-02, AT-16 (project), AT-27 (DB trigger) |
| Web client | In progress | — | P1 web foundation agent |
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
