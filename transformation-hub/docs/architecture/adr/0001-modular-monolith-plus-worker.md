# ADR-0001 — Modular monolith plus worker

- Status: Accepted (engineering) · Date: 2026-09-29 · Deciders: delivery-orchestrator, solution-architect
- Requirements: REQ-ARC (spec §13 "Start with a modular monolith plus a worker")

## Context
The platform has ~15 business modules with heavy cross-module rules (gates read evidence, CPs, readiness; reports read
everything). The team size and Mobily's private-hosting constraint favour few deployable units.

## Decision
One NestJS codebase (`apps/api`) with two entrypoints: `main.ts` (HTTP API) and `worker.ts` (outbox dispatch, durable
jobs, schedules, report rendering, AI runs). Modules live in `src/modules/<name>` and talk through service interfaces
and outbox events, not through each other's tables. The web client (`apps/web`) is a separate Next.js process that only
talks to the API over HTTP.

## Consequences
- Two container images at most (api/worker share an image; web separate). No microservices, no service mesh required.
- Module boundaries are enforced by convention + review (and folder ownership), not by process isolation.
- Worker can scale independently; jobs are idempotent (ADR-0004).
