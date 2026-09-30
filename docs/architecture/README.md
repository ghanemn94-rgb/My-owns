# Architecture (P1 / DG1)

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
| [erd.md](erd.md) | P1 physical ERD plus the conceptual ERD of all 81 §16 entities |
| [data-dictionary.md](data-dictionary.md) | P1 tables: columns, types, constraints, indexes, invariants |
| [p1-work-split.md](p1-work-split.md) | File ownership and integration order for the parallel P1 tasks |
| [discovery/p1-stack-discovery.md](discovery/p1-stack-discovery.md) | Version, licence and support evidence ([V-LOCAL] vs [UNVERIFIED]) |
| [../api/openapi.yaml](../api/openapi.yaml) | The P1 API contract (OpenAPI 3.1.1) |

The playbook is a practical synthesis inspired by PMI, Brightline and BRM. Nothing here claims official PMI
status, Mobily brand compliance or regulatory compliance. `#0078FF` is a provisional brand token.
