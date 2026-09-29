# ADR-0007 — Contracts: Zod schemas + route registry → validation, OpenAPI, typed client

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §13 (documented OpenAPI, input/output schemas, safe generated client), §14 (API versioning, validation)

## Decision
`packages/contracts` holds Zod 4 schemas and a route registry (`defineRoute({ id, method, path, permission, params,
query, body, response })`). The API validates every request against the route's schemas (400 problem+json on failure),
the web client (`apps/web/src/lib/api.ts`) is typed from the same registry, and `pnpm openapi` emits OpenAPI 3.1 from
the registry using Zod's JSON Schema export. A startup check fails if any controller route lacks a registry entry.
Base path `/api/v1` gives versioning.
