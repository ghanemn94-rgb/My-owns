# Architecture (P1 / DG1, P2 / DG2, P3 / DG3)

This folder holds the architecture of the Mobily Transformation Hub, a modular monolith. solution-architect
owns it; changes after DG1 approval go through the orchestrator.

| Document | Content |
|---|---|
| [adr/ADR-0001](adr/ADR-0001-runtime-language-package-manager.md) | Node 24 LTS target / 22.18 floor, TypeScript 6.0.2, ESM only, pnpm 10.33.0, exact pins |
| [adr/ADR-0002](adr/ADR-0002-modular-monolith-boundaries.md) | Processes, API modules, package ownership, dependency direction |
| [adr/ADR-0003](adr/ADR-0003-persistence.md) | PostgreSQL 18 (floor 16), Kysely + pg, forward-only SQL migrations, UUIDv7, timestamptz, numeric + decimal.js, optimistic concurrency (409/428), archive vs retention |
| [adr/ADR-0004](adr/ADR-0004-audit.md) | Append-only `audit_event` (trigger + privileges) |
| [adr/ADR-0005](adr/ADR-0005-identity-sessions.md) | OIDC code + PKCE (openid-client), PG sessions, CSRF, dev-only login, Keycloak test IdP, (iss, sub) binding |
| [adr/ADR-0006](adr/ADR-0006-authorization.md) | Scoped RBAC, permission catalogue, one policy function, admins are not approvers, SoD hooks, delegation outline |
| [adr/ADR-0007](adr/ADR-0007-api-conventions.md) | REST /api/v1, contract-first OpenAPI 3.1, RFC 9457, cursor pagination, zod, rate limiting (T-3), request IDs |
| [adr/ADR-0008](adr/ADR-0008-background-jobs.md) | pg-boss, transactional outbox, idempotency ledger, retries, dead-letter queue, cron in Asia/Riyadh |
| [adr/ADR-0009](adr/ADR-0009-frontend.md) | React/Vite/Router/Query/Table/RHF, i18next, RTL, tokens and contrast, OFL fonts, provisional wordmark, axe |
| [adr/ADR-0010](adr/ADR-0010-evidence-storage.md) | Filesystem storage adapter; optional S3 adapter; licence flags L-1…L-4 |
| [adr/ADR-0011](adr/ADR-0011-packaging-configuration.md) | Image, Compose, configuration, no outbound internet |
| [adr/ADR-0012](adr/ADR-0012-testing-strategy.md) | Unit / integration (real PostgreSQL) / contract / e2e (Playwright 1.56.1, CF-2) / a11y / visual |
| [adr/ADR-0013](adr/ADR-0013-ci-delivery-gate-dependency.md) | `ci.yml` with a first `delivery-gates` job (REQ-DLV-025); file in [ci/ci.yml](ci/ci.yml) |
| [adr/ADR-0014](adr/ADR-0014-configuration-versioning.md) | Methodology/form/formula versions pinned per transformation (outline) |
| [adr/ADR-0015](adr/ADR-0015-decision-and-product-gate-model.md) | P2: one decision model (T04/gate/T16); product-gate engine G1–G3 (required outputs, versioned submissions, unverified evidence, 403/409); separate from DG0–DG7 |
| [adr/ADR-0016](adr/ADR-0016-p2-data-model-registers-guards.md) | P2: typed register tables T01–T04 + TOM canvas; database record guards (version step, audit coverage at COMMIT, append-only); starter structure |
| [adr/ADR-0017](adr/ADR-0017-charter-versioning-and-direction.md) | P2: charter current row + immutable version snapshots; North Star; outcomes; guardrails |
| [adr/ADR-0018](adr/ADR-0018-evidence-repository-and-verification.md) | P2: evidence items, content revisions, links, verification state |
| [adr/ADR-0019](adr/ADR-0019-value-pool-quantification-decimal-unknown.md) | P2: value pools quantified (decimal upside/downside) or explicitly unquantified, never zero; Unknown rule |
| [adr/ADR-0020](adr/ADR-0020-role-catalogue-p2-authorization.md) | P2: permission catalogue + role defaults; record-level rules; read-only auditor write-deny |
| [adr/ADR-0021](adr/ADR-0021-p3-portfolio-initiative-lifecycle-g4.md) | P3: S16-016 entity group, initiative lifecycle with exact 422 texts, End-to-End vs Modular (inherited approvals as evidence, waivers), TOM/portfolio separation, G4 criteria, G1 agreement extension, readiness view, implementer rules |
| [adr/ADR-0022](adr/ADR-0022-p3-prioritization-scoring-ranking.md) | P3: T06 versioned immutable weight sets, exact decimal weighted score (3.30), 'incomplete', 0–100 view, ranking snapshots with causes, overrides |
| [adr/ADR-0023](adr/ADR-0023-p3-roadmap-dependencies-capacity-funding.md) | P3: T07 waves verbatim, milestones/deliverables, one roadmap read model, T08 on the canonical dependency with a race-free cycle guard, schedule flags (no critical path), capacity, selection and funding |
| [adr/ADR-0024](adr/ADR-0024-p3-business-case-and-formula-foundation.md) | P3: ten-section business case, one class per line, set-based roll-up, Finance validation before G4, T09 restricted formula language (EBNF, typed units/periods, decimal.js only), seeded examples |
| [adr/ADR-0025](adr/ADR-0025-p4-calendar-time-jobs-work-items.md) | P4 foundation: business calendar (Asia/Riyadh, configurable workweek, administered holidays, working-day arithmetic), observation period vs business date vs event instant, the scheduled-job kit on pg-boss, My Work items and the in-app inbox |
| [adr/ADR-0026](adr/ADR-0026-p4-groups-delegation-approvals-t11-t12.md) | P4 governance: governed groups and role mapping (no fallback), delegation with loop guard, the canonical P4 approval record (four outcomes, SoD, stale 409, timer escalation that never approves), T11 decision rights with SLA types, T12 RACI per transformation with one accountable |
| [adr/ADR-0027](adr/ADR-0027-p4-kpi-data-model-and-pipeline.md) | P4 KPI engine data model: dictionary v2 (DG2 definition + versions), reporting periods, KPI formula graph with cycle guard, versioned RAG thresholds, approved target trajectories (DG2 T02 kept), actual slots with value versions and review/direct-accept routes, the accept pipeline (one audit event, one calculation run), data-quality findings, RAG overrides |
| [adr/ADR-0028](adr/ADR-0028-p4-kpi-calculation-semantics.md) | P4 KPI calculation semantics: four measure types, period vs cumulative, pp vs %, expected-to-date from the approved trajectory (never task completion), RAG with versioned thresholds, Unknown/Stale/Not computable, explicit aggregation (weighted ratios, no averaging, no unit mixing), KPI formulas on the unchanged DG3 engine |
| [erd.md](erd.md) | P1 physical ERD, the P2 physical ERD (§1b, migrations 0010–0018), the P3 physical ERD (§1c, migrations 0020–0024) and the conceptual ERD of all 81 §16 entities |
| [data-dictionary.md](data-dictionary.md) | P1, P2 and P3 tables: columns, types, constraints, indexes, triggers, grants, invariants |
| [p1-work-split.md](p1-work-split.md) | File ownership and integration order for the parallel P1 tasks |
| [p2-work-split.md](p2-work-split.md) | File ownership, contracts, seams and integration order for the parallel P2 tasks |
| [p3-work-split.md](p3-work-split.md) | File ownership, contracts, seams, integration order and requirement owners for the eleven P3 tasks |
| [discovery/p1-stack-discovery.md](discovery/p1-stack-discovery.md) | Version, licence and support evidence ([V-LOCAL] vs [UNVERIFIED]) |
| [../api/openapi.yaml](../api/openapi.yaml) | The API contract (OpenAPI 3.1.1): 33 P1 + 128 P2 + 109 P3 operations (270) |

The playbook is a practical synthesis inspired by PMI, Brightline and BRM. Nothing here claims official PMI
status, Mobily brand compliance or regulatory compliance. `#0078FF` is a provisional brand token.
