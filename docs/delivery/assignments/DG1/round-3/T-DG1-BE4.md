# Assignment T-DG1-BE4: backend round-3 repairs (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-3 repair). **Base revision:** current `HEAD` of branch `claude/mobily-transformation-platform-kwcc4i` (≥ `45d0297`). Dedicated git worktree; `node_modules` present; run **offline**; no `pnpm install` (dependency requests go in the handback).
- Fix **only** the two findings below (read their full text in `docs/delivery/findings.json`). Do not widen scope.

## Scope — write ONLY `apps/api/**`, `apps/worker/**`, `packages/db/**`, `packages/config/src/**` (not any `package.json` dependency block, not `pnpm-lock.yaml`).

## Findings

### F-DG1-115 (Medium, mandatory) — the derived creator assignment can outlive a concurrent revocation (write-skew)
The F-DG1-106 fix gives a BU-scoped Lead an explicit derived transformation-scope assignment when they create a transformation. Under READ COMMITTED, a create that overlaps a revocation of the source BU grant leaves an **active** derived assignment after the source is revoked (the revoke's cascade cannot see the not-yet-committed derived row; the create read the source as active without locking it). Reproduced 3/3 (`docs/delivery/test-evidence/DG1/code-security/round-2/repro-derived-assignment-race.test.ts`).
**Fix:** in the derive step (`apps/api/src/modules/access/assignments.ts` / wherever `grantCreatorTransformationRoles` resolves the source grant), lock the source grant row and re-check it is still active **within the create transaction** before inserting the derived row — e.g. `SELECT … FROM scoped_assignment WHERE id = <source> AND revoked_at IS NULL FOR SHARE` (or `FOR UPDATE`), and if it is gone/revoked, do **not** create the derived assignment (and surface the create accordingly). This serializes against the revoke's `FOR UPDATE`, so either the derive blocks until the revoke commits and then sees it revoked (and skips), or the revoke blocks until the derive commits and its cascade then revokes the new row. **Prove it:** add an integration test that reproduces the interleaving (a timing hook like the reviewer's is fine) and shows the derived assignment is revoked (or never created) when the source is revoked concurrently — the test must fail on the current code and pass on the fix. Keep the existing F-DG1-106 behaviour (normal create → audited derived assignment; revoke cascades) intact.

### F-DG1-117 (Low) — the module dependency-lint misses obfuscated loaders
`architecture.test.ts` (after F-DG1-109) catches `createRequire()` and computed `import()`/`require()`, but not `process.getBuiltinModule('…')` with a computed member, nor `new Function(…)` used to load across a module boundary. Extend the lint to detect these, and add planted cases that fail on the current lint and pass after. Keep it a static check (no execution).

## Self-verification (offline)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm test`; the focused integration test for the race on a **real disposable PostgreSQL** (`packages/db/test/global-setup.ts`; use a unique port e.g. `5460` via `TEST_DATABASE_ADMIN_URL` / `QA_E2E_PG_PORT`). Record real output. Anything you cannot run is BLOCKED, never a silent pass.

## Handback
`docs/delivery/handbacks/DG1/round-3/T-DG1-BE4-backend-workflow-engineer.md` — per finding: the fix, the test (failed-before/passes-after), real output; changed files; any dependency request; anything BLOCKED.
