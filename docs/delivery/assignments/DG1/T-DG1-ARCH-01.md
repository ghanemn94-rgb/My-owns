# Assignment T-DG1-ARCH-01: architecture decisions, data and API contracts, monorepo skeleton (solution-architect)

- **Stage:** P1 "Architecture and working foundation" / gate DG1 (BUILDING). **Base revision:** `9315878cac19f01d5c69557cd5eba87958c80fef`. HEAD may be ahead by metadata-only commits under `docs/delivery/**`.
- **Preceding gate:** DG0 is APPROVED (`docs/delivery/gates/DG0.json`). `node tools/gates/validate.mjs --stage DG0 --historical` must pass. Run it and report the result.
- **You run first and alone.** Three implementers start after you in parallel git worktrees: backend-workflow-engineer (API, DB, worker), frontend-ux-engineer (web) and devops-engineer (containers, CI, Keycloak). Your skeleton and contracts are their shared foundation. They must not need to edit the same shared files concurrently, so **you own and create all shared configuration now**.

## Requirements in scope
- Read `docs/delivery/requirements.csv`. Your requirements are:
  - the rows with `final_gate` = DG1: REQ-DLV-025, REQ-DLV-033, REQ-S15-002, REQ-S15-005, REQ-S15-006, REQ-S16-001…004, REQ-S19-004, REQ-S19-006;
  - the P1 increments of every row whose `increments` include `P1`. List them with `python3 -c "import csv;[print(r['req_id'],r['final_gate'],r['title']) for r in csv.DictReader(open('docs/delivery/requirements.csv')) if 'P1' in r['increments'].split(';')]"`.
- Other inputs:
  - `docs/analysis/stage-plan.md` (the P1 section), `docs/analysis/permissions-matrix.md`, `docs/analysis/field-inventory.md` and `docs/analysis/user-journeys.md`;
  - master prompt §16 (architecture and data model), §15 (tokens and UX), §10 (roles and scoping), §12 (durable jobs and outbox), §19 (handover obligations that shape the design);
  - **stack discovery:** the prior session's scratchpad discovery note did not survive (ephemeral container), so **you perform the stack discovery yourself** as part of this task and author it at `docs/architecture/discovery/p1-stack-discovery.md` (deliverable 4). Environment already verified by the orchestrator: Node v22.22.2, npm 10.9.7, pnpm 10.33.0, corepack present, npm registry reachable (e.g. `npm view typescript version`). Identify and resolve the stack conflicts the ADRs mention yourself — at minimum: the Node.js LTS line to pin (CF-1), ESM-only vs CJS (T-1), the Playwright/Chromium browser-path setup so `playwright install` is never run (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, CF-2), the rate-limiting library (T-3), and the storage-adapter licence flags (L-flags) — recording each with the version, licence, support window and date checked.

## Deliverables (you create them; paths are fixed so the parallel implementers can rely on them)

### 1. Architecture decision records: `docs/architecture/adr/ADR-0001-*.md` onward
Use the Context / Decision / Alternatives / Consequences / Verification evidence format. Each ADR records the exact versions pinned and cites the licence, support window and date checked. At minimum cover:
- **Runtime and language:**
  - the Node.js LTS line (resolve conflict CF-1 in the discovery doc);
  - the TypeScript version;
  - ESM-only vs CJS (T-1);
  - the package manager: pnpm workspaces with a committed `pnpm-lock.yaml`.
- **Modular-monolith boundaries.** One API process with explicit modules:
  - identity/access
  - organization
  - transformations
  - methodology/config
  - workflows/approvals
  - kpi/benefits calc
  - reporting
  - evidence/files
  - automation/jobs
  - audit
  - admin

  Also cover:
  - the separate worker process;
  - which package owns what;
  - the dependency direction rules.
- **Persistence:**
  - PostgreSQL major version;
  - query layer choice (for example Kysely or plain `pg` with typed queries);
  - migrations tool: forward-only, and it must run on a fresh database;
  - IDs (UUID; say which version);
  - `timestamptz` everywhere;
  - `numeric` for money and rates, decimal library in TS;
  - optimistic concurrency with an integer `version` column, the API `If-Match`/ETag pattern and the 409 conflict contract;
  - soft-delete versus retention policy.
- **Audit:** an append-only `audit_event` table protected from ordinary modification (for example a trigger that rejects UPDATE/DELETE, plus a restricted DB role), recording actor, action, record type, record id, prior and new version, reason, request ID and timestamp.
- **Identity:**
  - OIDC authorization-code + PKCE via `openid-client`;
  - server-side sessions in PostgreSQL with secure HttpOnly cookies and CSRF protection;
  - a **dev-only local login** that is compiled/configured off in production and refused unless `AUTH_MODE=dev`;
  - Keycloak as the portable test IdP;
  - user subject binding with the `sub` + issuer pair for later rebinding (§19).
- **Authorization:**
  - scoped RBAC: role assignments scoped to organization, business unit, transformation or record;
  - a permission catalogue;
  - one server-side policy function used by every route, export and search;
  - technical admins are not business approvers;
  - separation-of-duties hooks;
  - delegation model outline.
- **API conventions:**
  - REST under `/api/v1`;
  - OpenAPI 3.1 as the contract, and how it is kept in sync (source-of-truth choice);
  - RFC 9457 problem+json errors;
  - cursor or offset pagination;
  - validation with zod (or equivalent) shared between API and web;
  - rate limiting (T-3);
  - request IDs.
- **Background jobs:** a DB-backed queue (choice and version), a transactional outbox, idempotency keys, bounded retry with backoff, a failure queue, scheduler/cron, and Asia/Riyadh working-day calendar support later.
- **Frontend:**
  - React, Vite, router, data fetching, tables and forms;
  - i18n library;
  - RTL via `dir`/`lang` on `<html>` and CSS logical properties;
  - design tokens as CSS custom properties generated from one token source, with a contrast validation script (REQ-S15-002/003);
  - locally bundled OFL fonts (REQ-S15-005);
  - a provisional text wordmark (REQ-S15-006);
  - no public CDN at runtime or build;
  - an accessibility testing approach (for example axe-core, run locally).
- **Evidence storage adapter:** a filesystem adapter first, an S3-compatible adapter optional later (flag licence L-flags).
- **Packaging:** Docker images, Compose services, and the no-outbound-internet runtime rule.
- **Testing strategy:**
  - unit (Vitest or `node:test`);
  - integration against real PostgreSQL (a disposable database per test run);
  - e2e with Playwright on the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`, and resolve CF-2);
  - visual screenshots in EN/AR.

### 2. ERD and data dictionary
- **ERD:** `docs/architecture/erd.md` (Mermaid) covering **all** §16 entity groups at conceptual level. Mark which tables P1 implements:
  - organization, business_unit;
  - app_user, user_identity;
  - role, permission, role_permission, scoped_assignment, delegation (P1 table, logic later);
  - session;
  - transformation (minimal P1 fields: id, org, BU, name, mode, status, current phase, sponsor/lead refs, timezone, currency, version, timestamps);
  - audit_event;
  - outbox_event;
  - job tables (as required by the queue choice).
- **Data dictionary:** `docs/architecture/data-dictionary.md` for the P1 tables: columns, types, constraints, indexes and invariants.

### 3. API contract
`docs/api/openapi.yaml` (OpenAPI 3.1) for P1:
- `GET /healthz`, `GET /readyz`;
- auth (login start/callback for OIDC, dev login, logout, `GET /api/v1/me`, including effective permissions per scope);
- organizations and business units (admin read/write);
- users and role assignments (admin);
- transformations (list with pagination and filters, create, get, update with `If-Match`, archive);
- `GET /api/v1/transformations/{id}/audit`.

Include error schemas and security schemes.

### 4. Monorepo skeleton (shared configuration; you own these files)
- **Root files:** root `package.json` with scripts `build`, `lint`, `typecheck`, `test`, `test:integration`, `e2e`, `format`, and `pnpm-workspace.yaml`. Keep `tools/*` out of the workspace, or include it harmlessly. Also `tsconfig.base.json`, the lint and format config, `.editorconfig`, `.gitignore` additions (node_modules, dist, coverage, .env, test artefacts) and `.nvmrc` or `engines`.
- **Package skeletons** with their own `package.json`, `tsconfig.json` and a minimal compilable `src/index.ts`, plus a README stating the package's responsibility:
  - `apps/api`, `apps/worker`, `apps/web`;
  - `packages/shared` (zod schemas, API types, problem types, permission catalogue constants);
  - `packages/db` (migrations, typed DB access, migration runner CLI);
  - `packages/config` (runtime config loader with validation; never read secrets from the repo);
  - `packages/design-tokens` (token source, CSS generation, contrast checker).
- **Empty but reserved directories** documented in the READMEs, for later stages: `packages/calc`, `packages/reporting`.
- **Install and build:** run `pnpm install` so `pnpm-lock.yaml` is committed, with exact versions pinned. Then show `pnpm -r build` and `pnpm -r typecheck` passing on the skeleton.
- **CI job (REQ-DLV-025):** add `.github/workflows/ci.yml` with `needs: delivery-gates` semantics. It can't reference a job in another workflow file, so either add the product jobs to a new workflow that re-runs `node tools/gates/validate.mjs --pipeline` as its first job and makes the other jobs depend on it, or use `workflow_run`. Explain your choice. `delivery-gates.yml` itself is protected; don't edit it.
- **Discovery document:** author `docs/architecture/discovery/p1-stack-discovery.md` recording the stack discovery you performed for this task — every version, licence and support window you verified (with the date and the command/source), and how you resolved each conflict (CF-1 Node LTS, T-1 ESM/CJS, CF-2 Playwright browser path, T-3 rate limiting, L-flags storage licence). It is the evidence behind the ADR version pins.

### 5. Implementation guides for the three parallel tasks: `docs/architecture/p1-work-split.md`
List each implementer's exact file ownership (directories and files), the contracts they consume, what they must not touch, and the integration order.

## Constraints
- Pin exact versions. Re-verify licences and support windows yourself (`npm view`, official docs). Record the evidence in the ADRs.
- The runtime must not depend on public CDNs, builder-hosted services or personal keys.
- Keep it maintainable and conventional.
- Don't implement business features beyond the skeleton. The implementers do that.
- The write guard stops you from editing `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**` and the delivery records.

## Acceptance checks (reviewers verify these independently)
1. `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r build` pass on a clean clone.
2. The ADRs cover every item above with pinned versions and evidence.
3. The OpenAPI file validates (use a locally installed validator such as `@redocly/cli lint` or `@apidevtools/swagger-parser`, pinned as a devDependency).
4. The ERD covers every §16 entity named in `REQ-S16-011`…`REQ-S16-022`.
5. The work split is unambiguous and has no shared-file conflicts.

## Handback
`docs/delivery/handbacks/DG1/T-DG1-ARCH-01-solution-architect.md`
