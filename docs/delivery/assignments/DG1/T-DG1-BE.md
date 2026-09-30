# Assignment T-DG1-BE: API, database, auth, audit and worker (backend-workflow-engineer)

- **Stage:** P1 "Architecture and working foundation" / gate DG1 (BUILDING). **Base revision:** `41be5ca` (HEAD may be ahead by later implementers' commits; you run first in the integration order).
- **Preceding gate:** DG0 is APPROVED. The architecture (T-DG1-ARCH-01) is committed: 14 ADRs, `docs/api/openapi.yaml`, `docs/architecture/{erd.md,data-dictionary.md,p1-work-split.md}`, the monorepo skeleton, and a committed `pnpm-lock.yaml`. `node_modules` is already installed in this tree, so `pnpm -r typecheck`/`build`/`test` run **offline** — do not run `pnpm install` (you have no network; dependency changes are requested in your handback, never applied yourself).
- **You are first in the integration order.** Frontend and QA code against `docs/api/openapi.yaml`, so keep it and `packages/shared/src/schemas/**` in exact lockstep.

## Your requirements
- Read `docs/delivery/requirements.csv`. Your DG1-completing rows include `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`. Your P1 increments include the persistence/auth/audit/jobs rows: `REQ-DLV-005/008..012/014/018/021/024/027..028/030..031`, `REQ-S10-001..004`, `REQ-S06-010`, `REQ-S16-005..012/026`, `REQ-S19-002..003`, `REQ-S20-012..014/023/031`, and the shared-record rows. List your exact set with:
  `python3 -c "import csv;[print(r['req_id'],r['final_gate'],r['title']) for r in csv.DictReader(open('docs/delivery/requirements.csv')) if 'P1' in r['increments'].split(';')]"` and record which you touched.

## Scope — you own (write) ONLY these (p1-work-split.md §2)
- `apps/api/**` except `package.json` dependencies: `src/modules/{platform,audit,identity,access,organization,transformations,jobs,admin}/**`, `src/server.ts`, `src/index.ts`, `test/**` (incl. `test/integration/contract/**`).
- `apps/worker/**` except `package.json` dependencies.
- `packages/db/**` except `package.json` dependencies: `migrations/**` (**the only writer of migrations**), `src/**` (Kysely types, pool, transaction helper, runner, CLI incl. `bootstrap`), `test/**` (incl. `test/global-setup.ts`), `seeds/dev/**` (synthetic dev-login users only, clearly marked synthetic, never run in production).
- `packages/config/src/**` except `index.ts`'s `ENV_VARS` names (frozen). The loader goes in `src/load.ts`; adding a variable is a request via the orchestrator.
- `packages/shared/src/schemas/**`: keep in lockstep with `docs/api/openapi.yaml`. A drift is a bug in the schemas, never a contract change.
- You may edit the `scripts` field of `package.json` files you own.

## Consumes (read, do not edit)
`docs/api/openapi.yaml` (all P1 operations); `docs/architecture/data-dictionary.md` (exact P1 tables, constraints, indexes, grants, triggers); ADR-0002 (module map + architecture test); ADR-0003/0004/0005/0006/0007/0008; `@mth/shared` constants and permissions.

## Deliver (P1)
- migrations `0001+` that apply to a **fresh DB**, with roles, grants, the **append-only audit trigger** and the **separation-of-duties trigger** (technical admins hold no business read/approval);
- the role and permission seed **equal to `permissions.ts`**;
- the `migrate`/`status`/`bootstrap` CLI (`mth-db`);
- the config loader (`src/load.ts`);
- OIDC login + callback, **dev login guarded by `AUTH_MODE=dev`** (compiled/configured off in production), server-side sessions in PostgreSQL, CSRF, `GET /api/v1/me` (effective permissions per scope), preferences;
- one server-side **policy function + scope filter** used by every route/export/search;
- org/BU/user/role/assignment admin endpoints;
- **transformation CRUD** with `If-Match`/409/428, archive, `Idempotency-Key`, **an audit event on every mutation**, an outbox event; `GET …/{id}/audit`;
- `GET /healthz`, `GET /readyz`; rate limits and request IDs;
- the worker's outbox relay, `transformation.created` handler with ledger, dead-letter queue, and session purge;
- unit + integration tests (against a **real disposable PostgreSQL** per run — see `packages/db/test/global-setup.ts`), contract tests, and the route-coverage test.

## Engineering conventions (CLAUDE.md; non-negotiable, reviewers verify)
- Every mutation: server-side authorization check, input validation (zod), optimistic concurrency (`version`/`If-Match`), and an audit event — **each covered by tests**.
- Decimal arithmetic for money/rates (`decimal.js`; never `parseFloat` — the lint bans it). Missing/stale data → Unknown/Stale, never zero or green.
- `timestamptz` everywhere; `numeric` for money; UUID ids per ADR-0003.
- No secrets in the repo; no public CDNs or builder-hosted runtime deps.
- If a required tool/credential is missing, the check is **BLOCKED** — never report a check as passed that did not run.

## Must not touch
`apps/web/**`, `packages/design-tokens/**`, `deploy/**`, `.github/**`, `e2e/**`, `tests/qa/**`, and the frozen files in p1-work-split.md §1 (`docs/api/openapi.yaml`, `docs/architecture/**`, root build config, `scripts/**`, `packages/shared/src/{constants,permissions,problem,index}.ts`, every `package.json` dependency block, `pnpm-lock.yaml`). The write guard also blocks `tools/**`, `.claude/agents/**`, `docs/source/**` and the delivery records.

## Acceptance checks (reviewers verify independently, offline)
1. `pnpm --filter @mth/db build` and the migration runner apply `0001+` cleanly to a fresh disposable PostgreSQL, then `mth-db status` reports up-to-date.
2. `pnpm -r typecheck` and `pnpm -r build` pass.
3. Integration tests pass against a real disposable PostgreSQL; contract tests confirm every response matches `docs/api/openapi.yaml`; the route-coverage test shows no unmatched P1 operation.
4. A cross-scope read/write is denied by the policy function (seed for A12); an optimistic-concurrency conflict returns 409 with `currentVersion` (A14); the outbox relay is idempotent (A13).
5. Every mutation writes an audit event; the audit table rejects UPDATE/DELETE; the SoD trigger blocks a technical admin from an approval grant.

## Handback
`docs/delivery/handbacks/DG1/T-DG1-BE-backend-workflow-engineer.md` — list changed files, requirements touched, checks run with real output, any dependency requests (name + exact version + why), and anything BLOCKED.
