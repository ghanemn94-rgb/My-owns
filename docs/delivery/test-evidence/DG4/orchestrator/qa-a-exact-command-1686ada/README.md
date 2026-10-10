# QA-A acceptance command, exact form, at `1686ada`

QA-A could not run its acceptance command exactly as written inside its confined sandbox: `node_modules` is read-only there, so Vitest's config loader fails before any test runs. It ran the command with `--configLoader runner` instead. The orchestrator re-ran the exact form in the dedicated tree `/home/user/wt/verify` at `1686ada`, where `node_modules` is writable:

- `QA_PG_PORT=24600 MTH_PORT_POOL=24601-24640 tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa` exited 0 (`integration-exact.log`): 6 files, 65 tests passed (A04 8, A05 17, A10 16, A12 14, A13 5, A14 5).
- `pnpm vitest run --project unit-node tests/qa/unit` exited 0 (`unit.log`): 1 file, 15 tests passed.
