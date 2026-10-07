# @mth/shared

**Responsibility.** Code shared by API, worker and web (ADR-0002):

- `src/constants.ts`: phases, modes, statuses and transitions, scope types, locales, defaults (Asia/Riyadh, SAR).
- `src/permissions.ts`: the permission catalogue and seeded role defaults (from `docs/analysis/permissions-matrix.md`).
- `src/problem.ts`: RFC 9457 problem types.
- `src/schemas/` (subpath `@mth/shared/schemas`): zod mirrors of `docs/api/openapi.yaml`.
- `src/calc.ts` (subpath `@mth/shared/calc`): the decimal.js calculation code, i.e. T06 scoring (`src/scoring.ts`, ADR-0022)
  and the T09 restricted formula engine (`src/formula/`, ADR-0024 §6).

The top-level `@mth/shared` entry stays dependency-free (constants and types only, ADR-0002). Code that needs zod or
decimal.js is on a subpath.

Rules: no I/O, no Node-only or DOM-only APIs, and no dependencies beyond zod and decimal.js.

**Owner:** solution-architect creates it. From P1, backend-workflow-engineer maintains `src/schemas/**` and keeps
it in lockstep with the OpenAPI contract; `constants.ts`/`permissions.ts` changes go through the orchestrator,
because both API and web consume them.
