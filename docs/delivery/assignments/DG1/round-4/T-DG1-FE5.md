# Assignment T-DG1-FE5: frontend round-4 repair (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (round-4 repair). **Base revision:** current `HEAD` (≥ `96e75cc`). Dedicated git worktree; `node_modules` present; run **offline**; no `pnpm install`. Write ONLY `apps/web/**`.

## Finding

### F-DG1-210 (Medium) — a BU-Lead's just-created transformation hides Edit/Archive + audit trail until reload (stale cached /api/v1/me)
After a business-unit-scoped Lead creates a transformation (F-DG1-004/106 path), the server grants them a derived transformation-scope assignment, but the client's cached `/api/v1/me` effective permissions are stale, so the detail page hides the Edit and Archive controls and the audit trail until a full page reload (in-app navigation does not fix it). It is fail-safe (the UI under-represents access; the server stays authoritative), but it breaks the create→edit/archive workflow. **Fix:** after a successful create (201), invalidate/refetch the `me` query (React Query `invalidateQueries`/`refetch`) — or otherwise refresh the effective-permission state — so a user who navigates to the new record sees the controls their server-granted access allows, without a manual reload. Do not over-grant on the client: the server remains authoritative; this only refreshes the cached grants. **Prove it:** a test (component with a mocked `me` refetch, and/or an e2e journey as a BU Lead) showing Edit/Archive + audit appear after create without a reload, in EN and AR.

## Self-verification (offline)
`pnpm --filter @mth/web typecheck/build`, `pnpm lint`, `pnpm check:no-cdn`, `pnpm test`; and the full e2e via `e2e/support/qa-stack.sh` (pre-installed Chromium; `QA_E2E_PG_PORT=5482`; `--workers=1`) in EN+AR still green. RTL/LTR correct. Anything you cannot run is BLOCKED.

## Handback
`docs/delivery/handbacks/DG1/round-4/T-DG1-FE5-frontend-ux-engineer.md` — the fix, the test/e2e evidence; changed files; anything BLOCKED.
