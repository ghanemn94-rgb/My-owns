# ADR-0002: Modular monolith, module boundaries and package ownership

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-001, REQ-S16-003, REQ-S16-005, REQ-S19-002.

## Context

§16 asks for a maintainable modular monolith with a separate background worker, "before considering microservices". The API needs explicit modules for identity/access, transformation records, workflows, formulas, reporting and administration. The shared-record rules also apply: one decision model, one dependency record shared by T08 and RAID, and one benefit register with allocations. They mean the modules must share one database and one transaction boundary, not copy data between services.

## Decision

### Processes (runtime units)

| Process | Package | Role |
|---|---|---|
| API | `apps/api` (`@mth/api`) | One Fastify process. It serves `/api/v1`, `/healthz`, `/readyz` and the built SPA (same origin). It can be scaled horizontally later (ADR-0007 covers rate limiting). |
| Worker | `apps/worker` (`@mth/worker`) | Separate OS process and container. Runs the outbox relay, pg-boss handlers and cron schedules. Never serves business HTTP. |
| Web | `apps/web` (`@mth/web`) | Static assets built by Vite and served by the API; there is no Node runtime in production. |
| Migrate | `packages/db` CLI (`mth-db migrate`) | One-shot job before API and worker start. |

The only shared runtime service is PostgreSQL. There is no Redis and no message broker (ADR-0008).

### API modules (`apps/api/src/modules/<name>/`, the map is in `apps/api/src/modules.ts`)

| Module | Owns (tables / concepts) | P1? |
|---|---|---|
| `platform` | HTTP plumbing: request ID, problem+json, ETag/If-Match, CSRF, rate limits, health/readiness | yes |
| `audit` | `audit_event` writer and queries | yes |
| `identity` | OIDC and dev login, `session`, `oidc_login_state`, `user_identity`, `/me` | yes |
| `access` | `role`, `permission`, `role_permission`, `scoped_assignment`, `delegation`, and **the policy function** | yes |
| `organization` | `organization`, `business_unit`; later calendars and branding | yes |
| `transformations` | `transformation`; later performance areas and the workspace header | yes |
| `methodology` | methodology, form and formula versions (ADR-0014) | P2/P5 |
| `workflows` | gates, approvals, decisions, change requests, SoD | P2+ |
| `kpi` | KPI and benefit records; calculations delegated to `@mth/calc` | P4 |
| `reporting` | report snapshots and exports via `@mth/reporting` | P5 |
| `evidence` | evidence metadata and the storage adapter (ADR-0010) | P2/P6 |
| `jobs` | outbox writer (P1); automation rule admin and failure-queue views later | yes (outbox) |
| `admin` | admin endpoints composed from the other modules (users, assignments, org settings) | yes |

**The "users" admin endpoints** are served by `admin` routes that call `identity` (users and identities) and `access` (assignments).

### Dependency direction rules (enforced by an architecture test that backend-workflow-engineer writes in P1)

1. A module imports only:
   - its own files;
   - the `index.ts` (public surface) of the modules listed in its `dependsOn` in `modules.ts`;
   - `@mth/shared`, `@mth/config` and `@mth/db`.

   Importing a file deep inside another module is forbidden.
2. Every module may depend on `platform`, `audit` and `access`. Neither `audit` nor `access` depends on any business module.
3. The module graph must be acyclic. Upward requests (for example "transformation created → instantiate methodology") go through **outbox events** handled by the worker, not through reverse imports.
4. Only a module's own repository files write to its tables. Other modules read through its exported query functions. Reporting read models may use SQL views that the owning module defines.
5. Packages depend in one direction:
   - `apps/*` → `packages/*`;
   - `packages/db` → `packages/config`, `packages/shared`;
   - `packages/config` → `packages/shared`;
   - `packages/shared` and `packages/design-tokens` depend on no workspace package;
   - `apps/web` must not import `@mth/db` or `@mth/config` (browser bundle; no secrets).

### Workspace packages

| Package | Owns | Consumers |
|---|---|---|
| `@mth/shared` | constants, permission catalogue, problem types (top level, dependency-free); zod schemas (`@mth/shared/schemas`); decimal calculation code: T06 scoring and the T09 formula engine (`@mth/shared/calc`, P3, ADR-0024 §6) | api, worker, web, db |
| `@mth/config` | env var catalogue and validated loader | api, worker, db CLI |
| `@mth/db` | SQL migrations, migration CLI, Kysely types, pool/transaction helpers, test DB setup | api, worker |
| `@mth/design-tokens` | token source, CSS generation, contrast checker | web |
| `packages/calc` (reserved, P4) | pure decimal KPI/benefit calculation engine | api `kpi`, worker |
| `packages/reporting` (reserved, P5) | snapshot assembly and document exports | api `reporting`, worker |

**`@mth/shared` entry points** (T-DG3-ARCH-02). The top-level `@mth/shared` exports only dependency-free constants and types. Code that needs a runtime library goes on a subpath, so a consumer of the top level never loads it:

- `@mth/shared/schemas` (zod, plus `value.ts` on decimal.js);
- `@mth/shared/calc` (decimal.js: `scoring.ts` and `formula/`).

Each subpath is one `exports` entry in `packages/shared/package.json`, with the conditions `@mth/source` → `src/…`, `types` → `dist/….d.ts` and `default` → `dist/….js`. tsc (`customConditions`), Node (`--conditions=@mth/source`), Vite and vitest resolve it the same way. A new subpath needs an ADR note; it is never added by a feature task.

## Alternatives considered

- **Microservices per domain.** Rejected by §16. They would also break the single-transaction canonical records and add network failure modes that IT would have to operate.
- **NestJS modules.** Heavier framework conventions (decorators, DI container), and `erasableSyntaxOnly` rules out experimental decorators. Plain Fastify plugins with an explicit module map are simpler to maintain.
- **A separate BFF for the web.** Unnecessary: the web app is a static bundle and the API serves it on the same origin.

## Consequences

- Business modules can be added later without new processes.
- A module can later be split into its own service only if IT justifies it (§16), because boundaries and outbox events already exist.
- Reserved module and package names avoid churn later: later stages add code inside fixed boundaries.

## Verification evidence

The modules are listed in `apps/api/src/modules.ts`. The offline tsc 6.0.2 compile of `apps/api` passed [V-LOCAL 2026-09-30, discovery doc §4]. The architecture test itself is delivered by T-DG1-BE.
