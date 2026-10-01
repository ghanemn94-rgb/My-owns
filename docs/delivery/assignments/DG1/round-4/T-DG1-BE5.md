# Assignment T-DG1-BE5: backend round-4 repairs (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-4 repair). **Base revision:** current `HEAD` (≥ `96e75cc`). Dedicated git worktree; `node_modules` present; run **offline**; no `pnpm install`.
- Fix **only** the two findings below (full text in `docs/delivery/findings.json`). Write ONLY `apps/api/**`, `apps/worker/**`, `packages/db/**`, `packages/config/src/**` (no `package.json` dependency block, no `pnpm-lock.yaml`).

## Findings

### F-DG1-009 (Medium) — integration non-determinism: the forced DB drop surfaces an uncaught 57P01
The orchestrator has already serialized integration files (`vitest.config.ts` `poolOptions.forks.singleFork`), which removes the cross-file row pollution. The remaining half is your test infrastructure: a suite (seen in `apps/api/test/integration/access-derived-race.test.ts`, scratch DB `mth_f115_*`) drops its disposable database `WITH (FORCE)` in teardown while a pooled client is still connected, so PostgreSQL terminates that connection and the client emits an unhandled `error` (FATAL 57P01, "terminating connection due to administrator command") that fails the run even though all tests passed. **Fix** so a forced drop can never surface as an uncaught exception, e.g. in `packages/db/test/global-setup.ts` `dropScratchDatabase` (and/or the race suite): end every pool/client **before** dropping its database, and/or attach an `error` listener to pooled clients so an administrator-terminated connection during teardown is handled, not thrown. **Prove it:** run the full integration suite several times on fresh disposable PostgreSQL clusters (unique port e.g. `5481`) and show deterministic exit 0 with no unhandled 57P01 (and no a12 false red). Keep every existing test passing.

### F-DG1-121 (Low) — module lint misses AsyncFunction / aliased `.constructor`
Follow-on to F-DG1-117. `architecture.test.ts` still misses an obfuscated cross-module loader via the `AsyncFunction`/`Function` constructor reached through an **aliased** `.constructor` (e.g. `const C = (async()=>{}).constructor; C('return require')(...)`) rather than `new Function` directly. Extend the static lint to catch the `.constructor`-of-a-function-expression (and `async`/generator variants) construction, with a planted case that fails on the current lint and passes after. Still static (no execution).

## Self-verification (offline)
`pnpm -r typecheck/build`, `pnpm lint`, `pnpm test`; the **full integration suite run at least 3 times** on fresh disposable PostgreSQL (unique port), each deterministic exit 0. Record real output. Anything you cannot run is BLOCKED.

## Handback
`docs/delivery/handbacks/DG1/round-4/T-DG1-BE5-backend-workflow-engineer.md` — per finding: the fix, the repeated-run evidence, the planted-lint case; changed files; anything BLOCKED.
