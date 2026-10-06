# Handback T-DG2-DEVOPS3: disposable-cluster harnesses start deterministically (devops-engineer)

- **Stage / task:** DG2 (FIXING) / T-DG2-DEVOPS3. Repairs **F-DG2-310** (Low, REQ-DLV-034).
- **Assignment:** `docs/delivery/assignments/DG2/round-8/T-DG2-DEVOPS3.md` (sha256 `3eb57384…ab854d4`, verified before
  starting).
- **Invocation:** `DG2-T-DG2-DEVOPS3-devops-engineer-20261006T154150Z-4b8b62d9`, session `4b8b62d9-c346-47c1-88e2-f04c6671c695`.
- **Base:** `HEAD` = `06430a4c698e3db0d7b4b9645bdaaa6bcfddf87f`, branch `claude/mobily-transformation-platform-regate`.
  `git status` before writing showed only pre-existing untracked sandbox dotfiles (`.bashrc`, `.idea`, …).
  `CLAUDE.local.md` is also untracked; I did not create it. Nothing is committed: the orchestrator integrates.
- **Environment facts:**
  - Linux 6.18.44-fc-v70 x86_64, uid 0, so PostgreSQL runs as uid 1000 in a user namespace.
  - `ip_local_port_range` 32768-60999. Offline.
  - Node v24.21.0 (default PATH), pnpm 10.33.0 (runs on /opt/node22), PostgreSQL 16.13, Python 3.11.15.
  - Chromium from `/opt/pw-browsers` (chromium-1194). `playwright install` was never run.
  - `shellcheck` is not installed.
- **Evidence:** logs only, in `docs/delivery/handbacks/DG2/T-DG2-DEVOPS3-evidence/`.

## 1. Port policy (what was delivered)

All five harnesses source one shared helper, `tests/qa/support/pg-port.sh`, so the logic cannot drift between them.

**Defaults below 32768, distinct per harness.** API defaults were already outside the ephemeral range. The only API
change is qa-stack, which moves from a fixed 3000 to a configurable 3060, so it no longer shares with-stack's port.

| Harness | PostgreSQL (old → new default) | API (default) | Strict flags |
|---|---|---|---|
| `tests/qa/support/with-pg.sh` | `QA_PG_PORT` 54351 → **24351** | — | `QA_PG_STRICT_PORT` |
| `apps/web/e2e/support/with-stack.sh` | `E2E_PG_PORT`/`QA_PG_PORT` 54331 → **24331** | `E2E_API_PORT` 3000 | `E2E_PG_STRICT_PORT`, `E2E_API_STRICT_PORT` |
| `e2e/support/qa-stack.sh` | `QA_E2E_PG_PORT` 54361 → **24361** | new `QA_E2E_API_PORT` **3060** (was a fixed 3000) | `QA_E2E_PG_STRICT_PORT`, `QA_E2E_API_STRICT_PORT` |
| `e2e/clean-start/a18-clean-start.sh` | `QA_A18_PG_PORT` 54371 → **24371** | `QA_A18_PORT` 3181 | `QA_A18_PG_STRICT_PORT`, `QA_A18_STRICT_PORT` |
| `deploy/scripts/clean-start-local.sh` | `MTH_LOCAL_PG_PORT` 54340 → **24340** | `MTH_LOCAL_PORT` 3100 | `MTH_LOCAL_PG_STRICT_PORT`, `MTH_LOCAL_STRICT_PORT` |

`MTH_STRICT_PORT=1` turns strict mode on for every harness.

**Retry on bind failure.** The requested port is only a starting point, whether it is the default or comes from the
environment. A port inside the ephemeral range gets a logged warning.

- **When it counts as a bind failure:** the process exits and its own new log output contains
  `Address already in use|EADDRINUSE`. A port that already accepts connections counts as in use too, so a foreign
  server is never mistaken for ours.
- **What happens then:** the harness restarts the service on a random port from `MTH_PORT_POOL` (default
  `25000-31999`). It skips the ephemeral range, ports already tried, and any port with a socket in any state in
  `/proc/net/tcp{,6}`. It does this up to `MTH_PORT_RETRIES` more times (default 10) and logs every retry:
  `port-policy: PostgreSQL: port 24351 is in use (EADDRINUSE; attempt 1 of 11); retrying on port 26616`.
- **Readiness:** PostgreSQL counts as ready only when *its own* log says "ready to accept connections" and the
  postmaster is alive. An API counts as ready when its PID is alive and its health endpoint answers.
- **Strict:** with `*_STRICT_PORT=1`, a conflict prints `BLOCKED: … forbids another port` and exits 3. The command
  does not run.
- **No silent pass:**
  - PostgreSQL failing for another reason, or retries running out, prints `BLOCKED: …` and exits 3.
  - An API failing for a non-port reason keeps each harness's previous semantics: exit 4 "API not ready" in
    with-stack and qa-stack, and FAIL / exit 1 in a18 and clean-start-local, where API startup is the asserted
    behaviour. See §4.
- **Exported URLs follow the port actually used:**
  - `TEST_DATABASE_ADMIN_URL`, `DATABASE_URL` and `DATABASE_OWNER_URL`.
  - The a18 URLs and `BASE`.
  - clean-start-local's secret URL files and its `PROD`/`DEV` `APP_BASE_URL`.
  - `PORT`, `APP_BASE_URL` and `E2E_BASE_URL` in with-stack and qa-stack. Playwright reads `E2E_BASE_URL`.

**API port exposure (the question in the assignment).** The API defaults (3000, 3060, 3100, 3181) are below 32768, so
a kernel-assigned client port can never land on them. They are only exposed if someone sets a port inside the range.
A client socket explicitly bound to the port can still collide, and case C5 below shows that. The same retry covers
both cases.

## 2. Changed files

| File | Purpose |
|---|---|
| `tests/qa/support/pg-port.sh` (new) | Shared port policy: `mth_pg_start`, `mth_start_with_port_retry`, `mth_port_pick`, `mth_port_busy`; header documents the policy |
| `tests/qa/support/port-collision-check.sh` (new) | Automated TIME_WAIT repro + negative control (cases C1–C5) |
| `tests/qa/support/with-pg.sh` | Default 24351; starts PostgreSQL through `mth_pg_start`; header updated |
| `apps/web/e2e/support/with-stack.sh` | Default 24331; PostgreSQL and API through the helper; exports `PORT`/`APP_BASE_URL`/`E2E_BASE_URL` for the port used; cleanup now stops the postmaster with SIGINT and waits (as with-pg does) |
| `e2e/support/qa-stack.sh` | Default 24361; new `QA_E2E_API_PORT` (3060); exports `E2E_BASE_URL`; PostgreSQL and API through the helper. Also fixes the `echo "readyz: $(curl …)" \|\| …` check, which could never fail |
| `e2e/clean-start/a18-clean-start.sh` | Default 24371; PostgreSQL and API (all three starts) through the helper; non-port API failure is still FAIL |
| `deploy/scripts/clean-start-local.sh` | Default 24340; PostgreSQL and API through the helper. `PROD`/`DEV` are rebuilt by `set_mode_env` when the port changes. `spawn` appends to its log (needed for per-attempt log inspection) |
| `docs/operations/clean-start.md` | New section "Harness port policy" (table, retry, strict, exit semantics, regression check); env line for path B |
| `apps/web/e2e/README.md` | Port defaults and the retry/strict behaviour |

No product code (`apps/**/src`, `packages/**/src`), OpenAPI, migrations, `tools/**`, `.claude/**`, `docs/source/**`,
reviews or gate records were touched. `pnpm -r build` regenerated the git-ignored `dist/` folders.

**Checksums** (sha256, current files):

```
199330d277a3b1af4b9d3820bf4629e4c2a637c721f9eaf5fd0b7c0a588442d4  tests/qa/support/pg-port.sh
c56ed5dd6a8ab2b45339fa2375a19f1e28263294cd3717225ca1fb705df691e8  tests/qa/support/port-collision-check.sh
7453f50a9ef94a3c679d546eed150f33c629c0bbadc7822f7a8991d3d7794395  tests/qa/support/with-pg.sh
831f53014307de9354f69f218dc25cd32f126949afd82728df7b9b1c821854b7  apps/web/e2e/support/with-stack.sh
57d230e0ee4fe02f4847cc751f06605a0f2db4437ec30f67b5d5bcf4b00ef113  e2e/support/qa-stack.sh
d9f6861f07df561cf0cb4f67686aefccdcba700976c35cf815cd8416d52ecbd8  e2e/clean-start/a18-clean-start.sh
0ad43c8150c3c1556a301d39b1e0c35bff4b77ddd959c4a6feaf8c0c996d9728  deploy/scripts/clean-start-local.sh
67713170230a8b99c2a6a0a45ca5eb839e169d83080e95ec66e19e3a74621ae7  docs/operations/clean-start.md
343d90f37f558c2f53d066cc750dfe69b9b230e03cae82e7c0af6b95d84a9252  apps/web/e2e/README.md
```

All runs below used `pg-port.sh` sha256 `13c630da…f3e5c7`. After the runs I made one comment-only change: three
header lines saying that `<pid-var>`/`<strict-var>` must not reuse the helper's local names. After it, `bash -n` and
a `with-pg.sh` smoke start were re-run and passed (24351, attempt 1). No other file changed after the runs.

## 3. Checks actually run

All commands ran from `/home/user/My-owns` on the uncommitted working tree. Times are wall clock.

| # | Command | Result | Time | Log |
|---|---|---|---|---|
| 0 | `pnpm -r build` | exit 0 | 21.4 s | `00-build.log` |
| 1 | `tests/qa/support/port-collision-check.sh` | **PASS (5 cases)**, exit 0 | 40.4 s | `01-port-collision-check.log` |
| 2–7 | integration suite ×6: `<locale> tests/qa/support/with-pg.sh pnpm test:integration`; runs 1/3/5 `env -u LANG -u LC_ALL`, runs 2/4/6 `LANG=C.UTF-8` | each **32 files, 531/531 passed**, exit 0; each `port-policy: PostgreSQL listening on port 24351 (attempt 1)` | 59.5–60.8 s each | `10-integration-run{1..6}-*.log` |
| 8 | `env -u LANG -u LC_ALL PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/… apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1 --reporter=list` | **58 passed**, exit 0 (PostgreSQL 24331, API 3000, both attempt 1) | 3 m 44.1 s | `20-web-e2e-run1-unset-LANG.log` |
| 9 | same with `LANG=C.UTF-8` | **58 passed**, exit 0 | 3 m 44.8 s | `20-web-e2e-run2-LANG-C.UTF-8.log` |
| 10 | forced collision on the real stacks (TIME_WAIT on the default PostgreSQL **and** API ports) | with-stack: retried both (24331→28270, 3000→28577), readyz ready, exported URLs = server port, exit 0. qa-stack: retried both (24361→27779, 3060→31065), exit 0. qa-stack `QA_E2E_API_PORT=3061 QA_E2E_API_STRICT_PORT=1`: `BLOCKED: API port 3061 is in use (EADDRINUSE) …`, exit 3 | 4.3 s / 4.4 s | `30-stack-collision-demo.log` |
| 11 | `python3 -I $TMPDIR/tw.py 24371 3181 && e2e/clean-start/a18-clean-start.sh` | **A18 CLEAN START: PASS** (21 PASS lines). PostgreSQL 24371→31568, API 3181→29204; restart and unmigrated-DB starts reused 29204 (attempt 1). Exit 0 | 33.6 s | `31-a18-clean-start-with-collision.log` |
| 12 | `deploy/scripts/clean-start-local.sh` (TIME_WAIT on 24340 and 3100) | **BLOCKED**, see §4: attempt 1 (store in read-only HOME) exit 226; attempt 2 (writable copy of the store) `ERR_PNPM_NO_OFFLINE_TARBALL … @fastify/cookie-11.0.2`, exit 1, at step 2 (install), before any port logic | 23.9 s / 23.3 s | `32a-…ATTEMPT1-readonly-store.log`, `32-clean-start-local-with-collision.log` |
| 13 | partial check: clean-start-local's API-start block (the 42 lines from `MTH=(sh` to `wait_ready`, extracted verbatim) with a stand-in entrypoint; TIME_WAIT on 3100 | **PASS**: 3100 EADDRINUSE → 31711, `PROD` `APP_BASE_URL=http://localhost:31711`, service reports `PORT=31711`, exit 0 | <2 s | `33-clean-start-local-api-block-partial.log` (script included in the log) |
| 14 | `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, **exit 0** | — | `40-validate-historical-DG1.log` |
| 15 | `pnpm lint` | **exit 0** (eslint, `--max-warnings=0`) | — | `41-lint.log` |
| 16 | `pnpm format:check` | exit 2: only EACCES on the 12 sandbox-masked paths (`.bashrc`, `.zshrc`, `CLAUDE.local.md`, …); "All matched files use Prettier code style!" | — | `42-format-check.log` |
| 17 | `npx prettier --check . --ignore-path .gitignore --ignore-path .prettierignore --ignore-path $TMPDIR/masked.txt` | **exit 0**, all matched files formatted | — | `43-format-check-ignore-path.log` |

On #17: a first attempt concatenated the three ignore files into one. It flagged `deploy/images.lock.json`, which
`.prettierignore` excludes, so I discarded that attempt and passed the files separately. The log header says this.

### Repro and negative control (#1, `01-port-collision-check.log`)

Each case first proves the collision. A client socket is bound to port P without `SO_REUSEADDR`, which is exactly
what a kernel-assigned client port is. It connects, closes first and is left in TIME_WAIT. Then `/proc/net/tcp` must
show state `06`, and a `SO_REUSEADDR` bind+listen probe on P must fail with `EADDRINUSE`. If the collision cannot be
reproduced, the script reports BLOCKED (exit 3), so it can never pass vacuously.

```
== C1 negative control: OLD with-pg.sh, QA_PG_PORT=54351 held in TIME_WAIT
  collision on port 54351: /proc/net/tcp states ['06'] (06 = TIME_WAIT); SO_REUSEADDR probe: bind FAILED EADDRINUSE
  | BLOCKED: disposable PostgreSQL did not start
  | … FATAL:  could not create any TCP/IP sockets
  exit 3 after 33 s
  PASS old harness fails closed (exit 3, BLOCKED, postgres: Address already in use) -- the F-DG2-310 defect reproduced
== C2 NEW with-pg.sh, QA_PG_PORT=54331 held in TIME_WAIT
  | port-policy: warning: PostgreSQL port 54331 is inside the ephemeral range 32768-60999 …
  | port-policy: PostgreSQL: port 54331 is in use (EADDRINUSE; attempt 1 of 11); retrying on port 26598
  | port-policy: PostgreSQL listening on port 26598 (attempt 2)
  | URL=postgresql://postgres@127.0.0.1:26598/postgres
  | server port 26598
  PASS new harness retried and started on 26598 (< 32768); exported URL and server agree
== C3 NEW with-pg.sh, default port (24351) held in TIME_WAIT     -> retried, started on 26616: PASS
== C4 QA_PG_PORT=24352 in TIME_WAIT with QA_PG_STRICT_PORT=1
  | BLOCKED: PostgreSQL port 24352 is in use (EADDRINUSE) and QA_PG_STRICT_PORT=1 / MTH_STRICT_PORT=1 forbids another port
  PASS strict mode: no retry, exit 3 BLOCKED, the command did not run
== C5 generic API path (Node HTTP server, SO_REUSEADDR like the API); port 3000 held in TIME_WAIT
  | port-policy: API: port 3000 is in use (EADDRINUSE; attempt 1 of 11); retrying on port 31904
  | API answered: ok 31904 (MTH_PORT=31904)
  | api log: Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
PORT COLLISION CHECK: PASS (5 cases)
```

The negative control (C1) takes the pre-fix `with-pg.sh` straight from git (`--old-rev`, default `06430a4c`), so it
stays reproducible after this change is committed.

**Record counts.**
- Integration: 6 runs × 531 tests (32 files).
- Web e2e: 2 runs × 58 tests (29 per project in chromium-en and chromium-ar).
- a18: 19 migrations applied.
- with-stack / qa-stack collision demo: 19 migrations and 5 SYNTHETIC dev users per stack.

## 4. Known gaps / not done / deviations

1. **`deploy/scripts/clean-start-local.sh` was not run end to end: BLOCKED.**
   - The only pnpm store on this host (`/root/.local/share/pnpm/store/v10`, 224 MB) sits in the read-only HOME.
   - A writable copy under `$TMPDIR` does not contain `@fastify/cookie@11.0.2`, which the current lockfile needs.
   - With no network, `pnpm install --frozen-lockfile --offline` fails in step 2, and `assemble-runtime.sh` would hit
     the same prod install.
   - What did run: the script's new API-start code, verbatim, in check #13. Its PostgreSQL start uses the same
     `mth_pg_start` that #1–#11 exercised, but the scram-auth cluster path in this script was **not** executed after
     the change.
   - Re-run it on a host with a complete store: `MTH_PNPM_STORE=<store> MTH_PNPM_OFFLINE=1 deploy/scripts/clean-start-local.sh`.
2. **Exit code for API non-port failures (deviation, for the orchestrator to judge).** The assignment says "any other
   failure still exits 3 with `BLOCKED: …`". I applied that to PostgreSQL and to exhausted or strict port conflicts.
   For an API that fails for a non-port reason, I kept each harness's existing contract:
   - exit 4 "API not ready" in with-stack and qa-stack;
   - FAIL / exit 1 in a18 and clean-start-local, where the API starting is the acceptance criterion and BLOCKED would
     hide a product defect.

   Both are still non-zero and never silent. This is documented in `docs/operations/clean-start.md`.
3. **qa-stack's API default changed from 3000 to 3060** so the defaults are distinct per harness. qa-stack now exports
   `E2E_BASE_URL`, which `playwright.config.ts` already reads, and no `e2e/**` spec hard-codes 3000 (checked with
   grep). The only check of qa-stack after the change was the collision demo (#10). The full root `e2e/` acceptance
   suite was not in this assignment and was **not run**.
4. `e2e/support/qa-stack.sh` and `e2e/clean-start/a18-clean-start.sh` belong to qa-verifier (`e2e/**`). The assignment
   names them explicitly, so I edited them. qa should re-review them.
5. **`shellcheck` is not installed: NOT RUN.** Every changed script passed `bash -n`.
6. **Residual risk:**
   - Ports are chosen and then bound, which leaves a race. A loss is handled by the next retry.
   - The "already accepting" probe only checks `127.0.0.1`.
   - If `ip_local_port_range` is ever widened over the whole pool, `mth_port_pick` reports BLOCKED instead of
     picking an ephemeral port.
7. This only covers local disposable harnesses. It says nothing about high-availability production readiness.

## 5. Merge instructions

- No migrations and no dependency changes. Commit the 2 new files and 7 modified files above, plus this handback and
  `docs/delivery/handbacks/DG2/T-DG2-DEVOPS3-evidence/`.
- Sequencing: T-DG2-BE13 runs next and uses these harnesses. Keep invoking them as before:
  - Existing variables still work, so `QA_PG_PORT=…` is still accepted (as a starting point).
  - Anyone who needs a fixed port sets the harness's `*_STRICT_PORT=1`.
  - Read the port actually used from the exported URLs and the `port-policy:` lines on stderr.
- Expected conflicts: none. No other agent ran during this task.
