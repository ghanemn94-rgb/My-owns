# @mth/api

**Responsibility.** The single HTTP API process of the modular monolith (ADR-0002). It serves `/api/v1/**`
per `docs/api/openapi.yaml`, `/healthz` and `/readyz`, and the built web bundle (same origin, ADR-0005).

**Modules** (`src/modules/<name>/`, map and allowed dependencies in `src/modules.ts`): platform, audit, identity,
access, organization, transformations, methodology, workflows, kpi, reporting, evidence, jobs, admin.
P1 implements platform, audit, identity, access, organization, transformations, jobs (outbox writer) and admin.

**Rules.** Every mutation: policy check (`access` module, one function) → zod validation (`@mth/shared/schemas`)
→ `If-Match`/version check → write + audit event (+ outbox event) in one transaction (ADR-0003/0004/0006/0007).

**Owner from P1:** backend-workflow-engineer. Contract changes go through solution-architect.

Scripts: `build`, `typecheck`, `dev` (Node type stripping with the `@mth/source` condition), `start`.
