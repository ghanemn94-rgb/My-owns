# Handback: T-DG4-BE-R6 (backend-workflow-engineer): F-DG4-128 repair

- **Stage:** DG4 (FIXING after review round 6). **Task:** T-DG4-BE-R6. **Finding:** F-DG4-128 (Medium, REQ-S16-005), per D-131.
- **Invocation:** `DG4-T-DG4-BE-R6-backend-workflow-engineer-20261012T165509Z-a0381629` (session `a0381629-26e3-46cb-9349-00510479b5f0`).
- **Base:** worktree `/home/user/wt/dg4-be-r6`, branch `dg4/be-r6`, `HEAD` `8e2375cafc25ab1e77d33a55c89426633db4f39b`. It was clean before I started; untracked sandbox dotfiles (`.bashrc`, `.idea`, …) are not mine.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-R6.md`, sha256 `a7b69050…09eb91` (verified).
- **Time:** started `Mon Oct 12 16:55:21 UTC 2026`; ended `Mon Oct 12 17:41:31 UTC 2026` (about 46 minutes).
- **Changes are uncommitted**, for the orchestrator to integrate.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, **exit 0**, both before implementation and at the end.

## 1. Result

The shipped worker now always passes pg-boss an explicit supervision cadence. It is **60 s** by default and configurable through `WORKER_SUPERVISE_INTERVAL_SECONDS`, an integer from 1 to 600 that is validated at start-up. `createBoss` also refuses any value outside that range, so `undefined`/`NaN` can never reach pg-boss again.

Measured idle with the reviewer's script, shipped defaults, same machine, Node 24.21.0:

| | Before (HEAD `8e2375c`) | After (fix) | Reviewer's round-6 control (60 s) |
|---|---|---|---|
| `TimeoutNaNWarning` at start-up | **yes** (stack: `Boss.start` boss.js:46 ← `main` dist/main.js:28) | **none** | none |
| db `mth` transactions in 20 s, worker running | **188,362 (9,418/s)** | **332 (16/s)** | 333 (16/s) |
| worker CPU ticks (1/100 s) in 20 s | **1,631 (≈0.82 core)** | **37 (≈0.02 core)** | 13 |
| baseline, worker SIGSTOPped: transactions / ticks | 3,236 (161/s) / 0 | 61 (3/s) / 0 | 1,090 (54/s) / 0 |
| active worker statements sampled 1/s | pg-boss `UPDATE pgboss.queue SET maintain_on/monitor_on …` in most samples | none sampled | — |

- The "before" rate (9,418/s) is higher than the reviewer's 6,341/s. It is the same 1 ms loop on a different load. Before, the baseline phase was also higher (161/s), plausibly because the database was still working off the loop's backlog right after the SIGSTOP.
- **The residual 16/s is the worker's own polling.** The outbox relay polls every 1 s, the job workers poll every 2 s, and pg-boss's own timers fire every 30 s and every 60 s. It matches the reviewer's control exactly. My CPU figure (37 ticks) is higher than the reviewer's 13. The CPU load on this shared machine was not controlled, so I do not claim that difference means anything.
- Logs: `T-DG4-BE-R6-evidence/measure-supervise-before.log`, `worker-before.log`, `measure-supervise-after.log`, `worker-after.log`. Running `grep -c TimeoutNaNWarning` gives 1 in `worker-before.log` and 0 in `worker-after.log`.

## 2. Changed files

| File | Purpose |
|---|---|
| `apps/worker/src/queues/platform.ts` | New `superviseIntervalSecondsOf(value)`: it returns `value ?? 60` and throws a `RangeError` unless the result is an integer from 1 to 600. `createBoss` now always passes `superviseIntervalSeconds` to `new PgBoss(...)`; before, it passed it only when a caller gave one. |
| `apps/worker/src/queues/index.ts` | Re-exports `superviseIntervalSecondsOf`. |
| `apps/worker/src/main.ts` | `createBoss(config.databaseUrl!, { superviseIntervalSeconds: config.worker.superviseIntervalSeconds })`. The "mth-worker started" log line now includes `superviseIntervalSeconds`. |
| `packages/config/src/index.ts` | Adds catalogue entry `WORKER_SUPERVISE_INTERVAL_SECONDS` (optional, not secret, default `"60"`, used by `worker`) and the constant `SUPERVISE_INTERVAL_SECONDS = { min: 1, max: 600, default: 60 }`, with the rationale for the range. |
| `packages/config/src/load.ts` | `AppConfig.worker.superviseIntervalSeconds`: zod `coerce.number().int().min(1).max(600)`. An invalid value is a `ConfigError` that names the variable, never the value, and the worker exits 78 (existing pattern). |
| `packages/config/src/load.test.ts` | Unit tests: the default is 60 (unset or empty); 1, 17 and 600 are accepted; 0, -5, 601, 86400, 1.5, NaN, abc and Infinity are refused with exactly one problem naming the variable. |
| `.env.example` | Regenerated with `node deploy/scripts/generate-env-example.mjs` (the CI `--check` requires it): 22 variables, names only. |
| `apps/worker/test/integration/supervise-cadence.test.ts` | **New** (9 tests). See §3, item 2. |
| `apps/worker/test/interval-probe.mjs` | **New** test preload. It wraps the global `setInterval` (behaviour unchanged) and prints each delay, flagging the one created from `pg-boss/src/boss.js` (the supervision timer). |
| `docs/delivery/handbacks/DG4/T-DG4-BE-R6-evidence/*` | Logs and the adapted measurement scripts (§6). |

**Scope note, for the orchestrator.** The assignment names `apps/worker/**` and `apps/api/**` as my files. It also requires the cadence to be configurable "through the worker's configuration (env or config module, following the existing pattern)". ADR-0011 §3 says every setting is an environment variable listed in `ENV_VARS` in `@mth/config`, and CI checks `.env.example` against that catalogue. So I also changed `packages/config/src/{index,load,load.test}.ts` and `.env.example`. FE-R10 owns none of these files, and `apps/api` is unchanged. The `packages/config` change is additive. The only modified existing lines are the `load.ts` import, which adds `SUPERVISE_INTERVAL_SECONDS`, and the test import.

**Not changed (devops-owned):** `deploy/compose/compose.yaml` does not pass the new variable, so Compose deployments get the 60 s default. If operators should be able to tune it through Compose, devops can add `WORKER_SUPERVISE_INTERVAL_SECONDS: ${MTH_WORKER_SUPERVISE_INTERVAL_SECONDS:-60}` and a row in `docs/operations/configuration.md`. This is optional and not needed for the fix.

## 3. Repair items

### Item 1: the fix, and the audit of pg-boss option defaults

**The fix.** The cadence is 60 s by default, configurable and validated, as described in §2.

- **Why the range is 1–600.**
  - **1 s minimum:** pg-boss's own floor for its other intervals, and the value the restart tests use.
  - **600 s maximum:** a supervision pass is what fails an expired active job (one held by a dead worker) so that it is retried (REQ-S16-005, A13). Above 10 minutes that recovery would lag far behind job expiry. 600 s is also pg-boss's longest scheduler interval (`clockMonitorIntervalSeconds` ≤ 600).
- **Where the 60 s comes from:** D-131 and the finding, citing pg-boss's documentation. The installed `pg-boss@11.0.0` package contains no documentation of this option: no README entry, and `types.d.ts` gives only the type. I could not check the online documentation offline.

**Audit: every pg-boss option the shipped path leaves to pg-boss** (pg-boss 11.0.0 source: `src/attorney.js` `getConfig`, `applyMaintenanceConfig`, `applyScheduleConfig`, `applyPollingInterval`; `src/boss.js`; `src/manager.js`; `src/timekeeper.js`; `src/db.js`; `src/plans.js` `QUEUE_DEFAULTS`). The shipped constructor options are now `connectionString`, `application_name`, `migrate: false`, `schedule: true`, `supervise: true`, `superviseIntervalSeconds` and `max: 5`.

| Option (where pg-boss reads it) | Default in pg-boss 11.0.0 | Verdict |
|---|---|---|
| `superviseIntervalSeconds` (boss.js:46, `setInterval(…, x*1000)`) | **none, so NaN, so a 1 ms loop** | **The defect. Now always passed (default 60, 1–600).** |
| `monitorIntervalSeconds` (boss.js:126, per-queue monitoring and expiry gate) | 60 (attorney.js:216) | Given by pg-boss. Not passed in production; tests pass 1. |
| `maintenanceIntervalSeconds` (boss.js:148, deletion gate) | 86,400 (attorney.js:208) | Given by pg-boss. |
| `queueCacheIntervalSeconds` (manager.js:65, `setInterval`) | 60 (attorney.js:224) | Given by pg-boss. |
| `cronMonitorIntervalSeconds` (timekeeper.js:56, `setInterval`) | 30 (attorney.js:244) | Given by pg-boss. |
| `clockMonitorIntervalSeconds` (timekeeper.js:57, `setInterval`) | 600 (attorney.js:239) | Given by pg-boss. |
| `cronWorkerIntervalSeconds` (timekeeper) | 5 (attorney.js:249) | Given by pg-boss. |
| `schema` | `pgboss` (applySchemaConfig) | Given by pg-boss. |
| `warningSlowQuerySeconds`, `warningQueueSize` | not set in config; boss.js falls back to the constants 30 s and 10,000 | Safe: only an `if (config.x)` override. |
| `application_name` (db.js) | `pgboss` | Passed (`mth-worker`). |
| `max`, and the other `pg.Pool` options (db.js passes the config to `new pg.Pool`) | pg defaults | `max: 5` passed. The others (connection/idle timeouts) keep the `pg` library's defaults, which are finite. They are not pg-boss options. |
| `work()` `pollingIntervalSeconds` (worker.js loop) | 2 s (attorney.js:199–201) | Always passed by `startWorker` (default 2). |
| `work()` `batchSize` | 1 | Always passed (1). |
| Queue options (`expireInSeconds`, `retentionSeconds`, `deleteAfterSeconds`, `retry*`) | SQL `QUEUE_DEFAULTS` (15 min, 14 d, 7 d, retry 2/0/false) | Given by pg-boss. The worker passes retry and dead-letter settings and `ops.failed` retention explicitly. |
| `boss.stop` | — | `main.ts` passes `{ graceful, wait, timeout: 20000 }`. |

**Conclusion:** `superviseIntervalSeconds` is the only timer option in the shipped path that pg-boss leaves without a default. Every other `setInterval` in pg-boss gets a finite default. The test (item 2) confirms this at run time: every interval the real worker creates is a finite number of at least 1 ms.

### Item 2: the test

`apps/worker/test/integration/supervise-cadence.test.ts` (integration project, real disposable PostgreSQL, migrated scratch database):

1. **The shipped entry point with the shipped defaults.** It spawns `node --conditions=@mth/source --import test/interval-probe.mjs src/main.ts` with only `PATH`, `NODE_ENV=test`, `DATABASE_URL` and `LOG_LEVEL`, so `WORKER_SUPERVISE_INTERVAL_SECONDS` is unset. It waits for "mth-worker started", lets the worker run for 1.5 s, then sends SIGTERM.
   - The pg-boss supervision timer must be exactly `[60000]`.
   - Every timer must be a finite number of at least 1 ms.
   - stderr must contain neither `TimeoutNaNWarning` nor "NaN is not a number".
   - The started log must show `superviseIntervalSeconds: 60`, and the process must exit 0.
2. **A configured value is honoured.** `WORKER_SUPERVISE_INTERVAL_SECONDS=17` gives a 17,000 ms supervision timer, no warning, and exit 0.
3. **An invalid value is refused** (`0`, `601`, `1.5`, `abc`; 4 tests): exit 78, stderr says "WORKER_SUPERVISE_INTERVAL_SECONDS is invalid", no supervision timer is created, and the worker never logs "started".
4. **In process: `createBoss(url)` with no cadence**, the exact call the original `main.ts` made. With `setInterval` spied (stack-tagged) and a `process.on('warning')` listener, the supervision delay must be `[60000]`, every delay finite, and no `TimeoutNaNWarning` emitted.
5. **In process: the current `main.ts` call**, `createBoss(config.databaseUrl!, { superviseIntervalSeconds: config.worker.superviseIntervalSeconds })` with `loadConfig("worker", …)`, gives 60,000 and no warning.
6. **`superviseIntervalSecondsOf`/`createBoss` refuse** NaN, 0, -1, 601, 1.5 and Infinity with a `RangeError`.

The tests that pass 1 s explicitly are unchanged: `restart.test.ts:133`, `kpi-period-open-restart.test.ts:294`, and the `supervise: false` bosses in `support.ts` and the child files.

**It fails on the original code.** I temporarily restored the HEAD versions of the five changed source files (`apps/worker/src/{main.ts,queues/platform.ts,queues/index.ts}` and `packages/config/src/{index,load}.ts`), kept the new tests, and ran the file. **9 of 9 failed, exit 1** (`T-DG4-BE-R6-evidence/supervise-cadence-test-on-original-code.log`):

- tests 1–2: `expected 'MTH_INTERVAL_PROBE …' not to contain 'TimeoutNaNWarning'`;
- test 4: `expected [ NaN ] to deeply equal [ 60000 ]`;
- tests 3, 5 and 6: the original code has no configuration or validation.

I then restored the fix from a tar backup; `git diff --stat` matched before and after. On the fix: **9 of 9 pass, exit 0** (`supervise-cadence-test-on-fix.log`).

### Item 3: behaviour (A13 and the restart tests)

REQ-S16-005 acceptance, quoted: "A13: killing the worker mid-job and restarting it completes the job exactly once with no duplicate notification". The full integration suite was run (§4). It includes `apps/worker/test/integration/restart.test.ts` ("kill the worker mid-job and restart it (REQ-S16-005, A13)"), `kpi-period-open-restart.test.ts` and `tests/qa/integration/a13-job-idempotency.test.ts`. All passed in the full run: `restart.test.ts` (1 test), `kpi-period-open-restart.test.ts` (1 test) and `a13-job-idempotency.test.ts` (5 tests). The restart tests still pass `superviseIntervalSeconds: 1` explicitly and are unchanged. The new range (1–600) accepts that value.

### Item 4: measure

See §1. The reviewer's `measure-supervise.sh` was re-run on the fixed, rebuilt worker: **16 transactions/s and 37 CPU ticks in 20 s**. Before the fix it was 9,418/s and 1,631 ticks.

## 4. Checks run (Node 24.21.0, offline, ports 26150–26199)

`df -h .` before each full run: 17 GB free.

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` |
| `pnpm -r typecheck` | 0 | |
| `pnpm -r build` | 0 (both after the fix and before the "after" measurement, and again at the end) | |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | The first run **exited 123**: `packages/config/src/load.ts` and `load.test.ts` needed formatting. I ran `prettier --write` on those two files and re-ran the check, which passed. |
| `pnpm openapi:lint` | 0 | |
| `node deploy/scripts/generate-env-example.mjs --check` | 0 | `OK: .env.example lists exactly the 22 ENV_VARS names, none with a value` |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node and unit-web: **152 files, 2,929 passed**. unit-formula-nocodegen: **3 files, 259 passed, 2 skipped (261)**. |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 152 files / 2,929 passed; 3 files / 259 passed, 2 skipped. |
| `QA_PG_PORT=26160 MTH_PORT_POOL=26161-26199 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **209 files, 1,984 tests passed**, 0 failed. Run from 17:20:10 for 1,146 s. No retries; nothing re-run. |
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 (`PASS gate DG3 (historical)`) | |

**Counts against the reviewer's round-6 baseline** (`test-evidence/DG4/domain/round-6/test-node24.log`, `integration-full-run-1.log`):

- **Unit:** 2,917 → 2,929. The +12 are the new config tests (1 default, 3 accepted, 8 refused).
- **No-codegen project:** 259 passed and 2 skipped, the same as the baseline (the skips are not mine).
- **Integration:** 1,985 tests in 209 files → 209 files and 1,984 tests in this run. The reviewer's 209/1,985 included the reviewer's own `tests/qa/integration/zz-domain-r6.test.ts` (10 tests), which is not in the repository. So the repository suite went from 208/1,975 to **209/1,984**. The per-file diff against the reviewer's log has exactly two lines, that file and mine (`integration-per-file-diff-vs-reviewer-baseline.txt`); every other file's count is identical. The +9 tests in +1 file are `supervise-cadence.test.ts`.
- No pinned count exists in the repository that this changes.

## 5. Operations routed, contracts, schema

- **Operations routed:** none. No API operation was added or moved, so my `p4-pending-*.ts` list is unchanged. `contract.test.ts` is part of the integration run above.
- **Contract or schema needs:** none.
  - No migration and no OpenAPI or zod change.
  - The only new configuration is the `ENV_VARS` entry `WORKER_SUPERVISE_INTERVAL_SECONDS` (see the Compose note in §2).

## 6. Evidence (`docs/delivery/handbacks/DG4/T-DG4-BE-R6-evidence/`)

- **`with-stack-trace.sh` and `measure-supervise.sh`:** copies of the reviewer's round-6 scripts. The changes are listed in each header and are only these:
  - ports 26150/26151 (my range) instead of 26401/26402;
  - they run in this repository instead of `$TMPDIR/review-dom`;
  - the worker PID is exported as `WK_PID` by the stack script instead of being found with `pgrep -f` (the assignment forbids `pgrep -f`).

  The sampling logic is unchanged.
- **`measure-supervise-before.log`, `worker-before.log`:** the reproduction on HEAD, with `TimeoutNaNWarning` and its stack.
- **`measure-supervise-after.log`, `worker-after.log`:** the fixed worker.
- **`supervise-cadence-test-on-original-code.log`:** 9 of 9 fail on the original code.
- **`supervise-cadence-test-on-fix.log`:** 9 of 9 pass.
- **The check logs:** `typecheck.log`, `build.log`, `lint.log`, `prettier.log`, `openapi.log`, `test-locale-unset.log`, `test-c-utf8.log`, `integration.log`, `validate-dg3-end.log`.

All logs were written under `$TMPDIR` and copied here after each run finished. No CPU load loop was started, and no process was stopped with `pkill -f` or `pgrep -f`. The stacks' processes were stopped by the scripts' own PID-based traps.

## 7. Merge instructions

- Apply the uncommitted diff. There are no migrations and no ordering constraints.
- Rebuild (`pnpm -r build`) so that `apps/worker/dist` and `packages/config/dist` carry the fix. The stack and e2e scripts run `dist`.
- **Expected conflicts:** none with FE-R10, which works on web files only.

## 8. What remains

- Nothing that the assignment requires is left open. F-DG4-128 stays OPEN until a non-author reviewer verifies it; I do not close my own finding.
- **Optional, for devops or the orchestrator:** pass `WORKER_SUPERVISE_INTERVAL_SECONDS` through `deploy/compose/compose.yaml` and document it in `docs/operations/configuration.md` (see §2). Without this, Compose uses the 60 s default.
- **Not verified:** the reviewer suggested the 1 ms loop may have added to earlier load timeouts in stack and e2e runs (D-111, D-112, D-115). I did not measure that.
- **Evidence note:** each of `typecheck.log`, `lint.log`, `prettier.log` and `openapi.log` ends with an `exit=0` line that I appended after the run, from the exit status the shell reported at the time. `prettier.log` is the second, passing run; the first run (exit 123) is described in §4.

## 9. Gate systems

This repair is engineering work for DG4. No product gate G1–G6 and no business, Finance or IT approval was granted or simulated. Every database the tests and measurements used was disposable, with synthetic seed data.
