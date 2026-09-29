# CLAUDE.md — Mobily Transformation & Transactions Hub

This directory is a self-contained monorepo for the **Mobily Transformation & Transactions Hub** (working name,
configurable). The sibling `../trading_agent/` is an unrelated earlier project — never modify it.

- Specification: `docs/MASTER_PROMPT.md` (verbatim; do not edit). Requirement register:
  `docs/requirements/requirements.yaml`. Checkpoint: `docs/WORK_LOG.md`. Status: `docs/DELIVERY_STATUS.md`.
- Agents: `.claude/agents/*.md` + `.claude/AGENT_RULES.md` (every agent reads the shared rules).

## Source boundaries (non-negotiable)

1. No real Mobily data in this environment. Demo data is synthetic, flagged `is_demo = true`, visibly badged
   `Demo`, and excluded from actual reporting. The reference image / Excel workbook were **not available**
   in the build environment; image extraction was **not performed** (see `docs/source-register.md`).
2. Never invent employees, approvals, amounts, dates, partner identities, ownership %, incorporation status,
   or legal/regulatory determinations. Use `Role — To be confirmed`, `TBD`, `Assessment pending — specialist`.
3. Status vocabulary: Implemented / Tested / Simulated / Not configured / Blocked. Mocks are never "Connected".
4. No real messages, no external data transfer, no production deployment, no enterprise identity/infra changes.

## Architecture (see `docs/architecture/adr/`)

Modular monolith + worker. One API codebase, two entrypoints (`main.ts` HTTP, `worker.ts` jobs).

```
apps/api        NestJS 11 (CommonJS) — HTTP API (src/main.ts) and worker (src/worker.ts)
  src/platform/   config, db context (ALS tx), auth/session, policy (RBAC+ABAC), audit, outbox, jobs, errors,
                  contracts pipe, clock, storage adapter, health
  src/modules/<m> one folder per domain module (controller + service + commands)
  test/           integration & acceptance tests (real PostgreSQL)
apps/web        Next.js 16 App Router, React 19, Tailwind 4, TanStack Query; ar (RTL) / en (LTR)
packages/contracts  Zod 4 schemas + route registry (validation, OpenAPI 3.1, typed web client)
packages/domain     Pure TypeScript business rules (state machines, gate evaluation, schedule/CPM,
                    RAG/measurement, money, calendars, policy matrix) — no I/O, fully unit-tested
packages/db         Drizzle ORM schema (src/schema/<module>.ts), SQL migrations (migrations/),
                    post-migrate SQL (sql/: RLS, audit immutability), seeds (seed/demo, seed/bootstrap, templates)
deploy/         Dockerfiles, compose (dev/eval only), helm chart, private-mode configs
e2e/            Playwright end-to-end tests
docs/           specification, requirements, architecture, governance, security, ai, deployment, reviews
```

Core modules: identity, portfolio, project-config (templates), governance (committee/meetings/decisions/votes/
actions/authority matrix), planning (WBS/tasks/milestones/deliverables/dependencies/baselines/changes/RAID/
updates), gates (definitions/assessments/criteria/waivers/approvals), carveout (perimeter/transfers/agreements/
consents), newco (legal entities/incorporation/regulatory), readiness-tsa (readiness checks/cutover/TSA),
finance (snapshots/budget/models/benefits/KPIs), jv-dd (partners/rooms/scenarios/DD/findings/closings/CPs/
post-close), documents (documents/versions/evidence/source register/claims), reporting (snapshots/exports),
imports, integrations, notifications, ai (runtime PM), audit.

### Mandatory mutation flow
`AuthGuard (session)` → `PolicyService.assert(ctx, permission, resource)` → contract validation (Zod) →
domain rule (`packages/domain`) → **one DB transaction** containing the change + `audit_event` row +
`outbox_event` rows → worker consumes outbox/jobs. Status changes only via explicit commands
(`POST .../decisions/:id/submit`, `.../gates/:id/assess`, `.../cps/:id/verify` …). No generic PATCH may change
a status column.

### Isolation
- Every project-scoped table has `org_id` + `project_id`. Composite foreign keys `(project_id, id)` stop
  cross-project linking; services additionally call `assertSameProject`.
- Each request runs inside a transaction that sets `app.org_id`, `app.user_id`, `app.project_ids`
  (`set_config(..., true)`); PostgreSQL RLS policies on every table with `project_id` restrict rows to those
  projects. The app DB role is not the table owner and has no BYPASSRLS. RLS is defense-in-depth; the API
  still filters and authorizes explicitly.
- Outside-scope resources return **404**, never 403, so existence is not leaked. Counts/search/AI retrieval
  apply the same scope and document ACL (classification, partner room, clean team) **inside SQL**.

### Data conventions
- IDs: UUID v7 (time-ordered) generated in the app. Timestamps `timestamptz` UTC. Business dates `date`
  interpreted in the project timezone (default `Asia/Riyadh`, Sun–Thu working week, editable holidays).
- Money: `numeric(20,4)` + `currency` (ISO 4217) + `unit_scale` (1 / 1000 / 1000000). Never floats. Aggregation
  across currencies/units is rejected by `packages/domain/money` unless an explicit conversion basis is given.
- Optimistic concurrency: `version integer` on mutable records; commands take `expectedVersion`; mismatch → 409.
- Audit: `audit_event` is append-only (trigger rejects UPDATE/DELETE) and hash-chained (tamper-*evident*,
  not tamper-proof; see ADR-0014). Record history snapshots in `record_version` for versioned entities.
- Verification status for facts: `confirmed | historical_unverified | proposed | assumed | conflicting | unknown`.

### API conventions
- Base path `/api/v1`. Project resources under `/api/v1/projects/:projectId/...`.
- Errors: RFC 7807 `application/problem+json` with `type`, `title`, `status`, `detail`, `code`, `correlationId`.
  Never include secrets or stack traces.
- Lists: `?page=&pageSize=(<=100)&q=&sort=` → `{ items, page, pageSize, total }`. Totals are computed inside
  the caller's scope only.
- CSRF: cookie session (`hub_session`, httpOnly, SameSite=Lax, Secure in prod) + `x-csrf-token` header matching
  the `hub_csrf` cookie on every non-GET request.
- Every route is declared in `packages/contracts` (`defineRoute`) with its permission; the API refuses to boot
  if a controller route lacks a contract (checked at startup in dev/test).

### Web conventions
- Routes under `apps/web/src/app/(app)/...`; API calls through `apps/web/src/lib/api.ts` (typed by contracts),
  proxied same-origin via Next rewrites to the API. No DB access, no secrets in the client.
- All text via i18n keys (`apps/web/src/i18n/messages/{en,ar}/*.json`). Logical CSS properties only.
  Fonts bundled locally (no CDN). `Demo` badge on demo records.

## Commands (run from `transformation-hub/`)

```
pnpm install                     # install workspace deps (lockfile committed)
pnpm db:start                    # start local PostgreSQL 16 cluster (dev helper; see scripts/dev/)
pnpm db:migrate                  # apply SQL migrations + post-migrate RLS/audit SQL
pnpm db:seed:demo                # load clearly-labelled Demo sandbox data
pnpm dev                         # api (:4000) + worker + web (:3000)
pnpm test                        # unit + integration tests (needs PostgreSQL)
pnpm test:e2e                    # Playwright E2E (needs running stack)
pnpm typecheck && pnpm lint
```
(Exact scripts are defined in `package.json`; if this list and `package.json` disagree, `package.json` wins and
this file must be corrected.)

## Phase gates

P0 Discovery → P1 Foundation → P2 Governance & Delivery → P3 Carve-out & NewCo → P4 JV & Finance →
P5 AI PM → P6 Reporting & Interop → P7 Enterprise Readiness → P8 Pilot & Handover.
Each phase: scope + REQ IDs + tests first → runnable increment → real verification → ≥2 independent reviews
(QA + domain/security/architecture) in separate contexts → fix → gate report `docs/phases/Pn-gate-report.json`.
No PASS with open Critical/High findings or unexecuted verification.

## Resumption procedure

1. Read `docs/WORK_LOG.md` (current phase, last commit, known failures, next action).
2. `git log --oneline -15` and `git status` to confirm the checkpoint.
3. `pnpm install && pnpm db:start && pnpm db:migrate && pnpm test` to re-establish a green baseline.
4. Continue from "Next action". Update WORK_LOG after each integration.
