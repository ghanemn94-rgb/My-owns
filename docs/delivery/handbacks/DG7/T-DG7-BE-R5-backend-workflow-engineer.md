# Handback T-DG7-BE-R5 (backend-workflow-engineer): integration failures from the pre-freeze full run

- **Stage:** P7 / DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `b8ade09b6e3934bf38ad19b4b3858da775d4072f` (working tree clean except this run's own runs folder at start).
- **Invocation:** `DG7-T-DG7-BE-R5-backend-workflow-engineer-20261115T010459Z-9e3026bf`, session `9e3026bf-fe9c-4edf-a9e4-e0cbc88595d0`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-R5.md` (sha256 `a3cfc29b…f229`, verified).
- **Time:** start `2026-11-15T01:05:10Z`, end: see §3 (last line).
- Engineering work only. No product gate G1–G6 decision and no business, Finance or IT approval was granted, and nothing here touches a DG0–DG7 record. Product G6 never implies DG7.
- **No migration, no API endpoint, no permission, no product source file changed.** All four failures were test defects. The product behaviour they hit is the ADR's (details per item below).

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/api/test/integration/platform.test.ts` | Item 1: the four `/readyz` expectations now carry the ADR-0069 §2 contract `{database, migrations, storage, worker}`. |
| `apps/api/test/integration/platform/readiness-storage-worker.test.ts` | Item 4: the T-B2 read-only case is its own test. As uid 0 it finds a read-only mount in `/proc/self/mountinfo`. When there is none it is skipped with a `BLOCKED:` note, so it is never passed silently. |
| `apps/worker/test/integration/retention-archive.test.ts` | Item 3: the T-E14/T-E17 `processed_at` assertion follows PostgreSQL's text output (trailing fraction zeros dropped), plus an exact comparison with the database's own UTC text. |
| `apps/api/test/integration/automation/automation-version-at-occurrence.test.ts` | Item 2: the 0122-era setup gets a temporary empty stand-in for `identity_binding_hold`, dropped before 0123+. The migration copy loop copies only `NNNN_*.sql` files. |
| `packages/db/test/integration/migrate.test.ts` | Item 5: `copyMigrations()` copies only the `.sql` entries the reader loads (the stray `.claude/` directory crashed `cpSync`). |
| `packages/db/src/migrate.test.ts` | Item 5: a unit test pins the existing reader rule: a stray directory or note is ignored, and a misnamed `.sql` file is still refused. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R5-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R5-evidence/*` | Logs of every check below. |

`apps/api/test/support/p7-pending*.ts`: untouched. This task routes no operation.

## 2. Behaviour per item (REQ-S19-010 readiness, REQ-S21-002 via D-250 O2, retention ADR-0067, D-204)

**(1) `platform.test.ts`: `/readyz` keys (ADR-0069 §2; D-243 Q6; D-250 O2/O3).** The product already behaves as the ADR says, and the tests now assert it:
- `storage` gates readiness. It is evaluated only when `database` is `ok`, else `unknown`.
- `worker` is P6's `alive|stale|unknown`. It never gates readiness, and it is `unknown` when `database` is not `ok`.

Asserted bodies:
- Migrated shared database: `200 {ready, database ok, migrations ok, storage ok, worker <alive|stale|unknown>}`.
- Pending migration: `503 … pending, storage ok`.
- Gap below the highest applied id: `503 … fail, storage ok`.
- SQL_ASCII database: `database fail` → `storage: unknown, worker: unknown`, exact.
- Empty UTF8 scratch database: `database ok, migrations pending, storage fail, worker unknown`, exact. There is no `storage_setting` table, so the probe fails closed. The heartbeat read fails, which `health.ts` maps to `unknown`, never alive.

Worker `unknown` vs `alive` semantics, confirmed against ADR-0069 §2 and `health.ts`:
- The status is `readWorkerHeartbeat(db).status`: `alive` ≤ 90 s, `stale` older, `unknown` when no worker ever beat.
- A rejected heartbeat read is `unknown`.
- On the run's **shared** database `worker` is not deterministic, because other files insert `worker_heartbeat` rows concurrently (`operations/exceptions.test.ts` l.583–635). So `platform.test.ts` accepts only the three vocabulary values on that database, and the status there is decided by the gating checks alone.
- The exact `alive`/`stale`/`unknown` rule stays proven on a private scratch database by T-B2 (`readiness-storage-worker.test.ts`, unchanged heartbeat cases).

**(2) `automation-version-at-occurrence.test.ts`: devLogin 500. Root cause: test defect.** Reproduced (exit 1, `automation-repro-before-fix-exit1.log`). With `MTH_TEST_LOG_DIR` set, the API logged `relation "identity_binding_hold" does not exist` at `identityUnbound` (`identity/oidc.ts:238`), called from the dev-login route (`identity/routes.ts:275`). Excerpt: `automation-devlogin-500-root-cause.txt`.
- The suite deliberately runs the **current** API on a scratch database migrated only to `0122`, so that 0122's trigger records history for the 0123 backfill test.
- P7 BE-D (ADR-0064 §8) made dev login read `identity_binding_hold`, which `0133` creates.
- The product is right to assume its full schema. On such a database `/readyz` reports `migrations: pending`.

Fix (test only):
- After migrating to 0122, the suite creates an **empty** stand-in table with only the columns that read uses (`id, user_id, state`; SELECT for `mth_app`). With no row, no user is held, as on any installation without an import.
- It drops the stand-in before `migrate()` applies 0123+, so `0133` creates the real table. The existing assertion that the applied list starts at `0123_` still holds.
- The suite's migration copy loop also copied a stray `.claude/` directory in the first pre-freeze run (`".cla" <= "0122"`). It now copies only `/^\d{4}_[^/]+\.sql$/`.
- Result: 5/5 pass (`automation-after-fix-exit0.log`).

**(3) `retention-archive.test.ts` T-E14/T-E17: intermittent regex.**
- PostgreSQL renders `timestamptz` text without trailing fraction zeros (`…:51.914290` → `:51.91429`) and without any fraction at `.000000`.
- The regex is now `^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{0,5}[1-9])?\+00$`: 1–6 digits, never ending in 0, or absent.
- "Microseconds kept" is now proven exactly: each archived `processed_at` equals `(processed_at AT TIME ZONE 'UTC')::text || '+00'` of its own row, matched by `(consumer, idempotency_key)`, with the row count checked.
- The data and the product's encoding are unchanged.

**(4) `readiness-storage-worker.test.ts` T-B2 read-only case as uid 0.**
- The case is split out as `filesystem: a read-only directory -> fail (EACCES for a non-root process, EROFS on a read-only mount)`.
- Non-root: mode 0555 gives `EACCES`, as before.
- uid 0 bypasses mode bits. The test searches this process's whole mount table (`/proc/self/mountinfo`, field 6 contains `ro`, octal escapes decoded) for a directory where `access(W_OK)` fails with `EROFS`. That generalises the old fixed list `/usr, /sys, /proc/sys`. It runs the real probe there and expects `fail` with `EACCES|EROFS`.
- When none exists, the test calls `ctx.skip("BLOCKED: running as uid 0 with no read-only mount in /proc/self/mountinfo: …")` and writes the same line to stderr. The reporter shows `↓ … [BLOCKED: …]`, a skip and never a pass.
- In this sandbox `/` is a read-only mount, so the case **ran and passed** (EROFS).
- The skip path was verified with a temporary local edit that forced "no mount found". The result was `9 passed | 1 skipped` with the BLOCKED note (`t-b2-skip-path-simulated.log`). The edit was reverted, and the file was confirmed to hold the real line afterwards.
- Remaining cases (ok / ENOENT / ENOTDIR) are unchanged in their own test.

**(5) `packages/db` migration reading and non-`.sql` entries.**
- The product reader is already explicit. `listMigrationFiles()` takes only entries ending in `.sql` and refuses a `.sql` name that does not match `NNNN_snake_case.sql`. `migrate()` uses it.
- So the stray directory never reached product code. The "cannot copy a directory" crashes came from **test** copy loops: `migrate.test.ts` `copyMigrations()`, and the automation suite above.
- I found nothing in the ADRs asking for different reader behaviour, so `packages/db/src/migrate.ts` is **unchanged**.
- I fixed the two test loops and added a unit test that pins the existing rule (ignore a directory and a non-`.sql` file; still refuse `third.sql`).
- `dry-run.test.ts` and `seeded-texts.test.ts` already filter by the reader's list or by a regex.

## 3. Checks run (real exit codes; Node 24.21.0, `MTH_PNPM_OFFLINE=1`, uid 0, offline, disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh`)

| Command | Exit | Result / log |
| --- | --- | --- |
| `with-pg.sh npx vitest run --project integration platform.test.ts platform/readiness-storage-worker.test.ts` (first attempt) | 1 | 22 pass, 1 fail: the empty-UTF8 body showed `storage: fail`, then asserted (`readiness-first-attempt-exit1.log`) |
| `with-pg.sh npx vitest run --project integration automation-version-at-occurrence.test.ts retention-archive.test.ts` (before item-2 fix) | 1 | devLogin 500 reproduced (`automation-repro-before-fix-exit1.log`) |
| same automation file with `MTH_TEST_LOG_DIR` | 1 | root cause found (`automation-devlogin-500-root-cause.txt`) |
| `with-pg.sh npx vitest run --project integration automation-version-at-occurrence.test.ts` (after fix) | 0 | 5/5 (`automation-after-fix-exit0.log`) |
| `npx vitest run packages/db/src/migrate.test.ts` | 0 | 4/4 |
| `with-pg.sh … readiness-storage-worker.test.ts` with the temporary "no mount" edit (reverted) | 0 | 9 passed, 1 skipped `[BLOCKED: …]` (`t-b2-skip-path-simulated.log`) |
| `QA_PG_PORT=25411 with-pg.sh npx vitest run --project integration` platform.test.ts, platform/readiness-storage-worker.test.ts, automation/automation-version-at-occurrence.test.ts, retention-archive.test.ts, packages/db migrate.test.ts, contract/contract.test.ts | 0 | 6 files, 156/156 (`integration-affected.log`) |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| `pnpm test` | 0 | unit-node 3023/3023, unit-web 2179/2179, nocodegen 259 + 2 skipped (pre-existing skips) (`unit.log`) |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | FULL_PRETTIER | `prettier.log` (re-run after this handback was written) |
| `tests/qa/support/with-pg.sh pnpm test:integration` (whole integration project) | FULL_EXIT | FULL_SUMMARY (`integration-full.log`) |

## 4. Known gaps

KNOWN_GAPS

## 5. Open questions

- **O1 (orchestrator):** the stand-in approach in item 2 keeps the suite's design (the current API writing history under 0122's trigger). Any future P7+ table read on the sign-in or automation paths will break it the same way. A sturdier alternative is to write the 0122-era history in SQL instead of through the API, at the cost of fidelity. Keep the stand-in, or redesign?
- **O2:** stray `.claude/.cc-writes` folders inside the product tree (they showed up under `packages/db/migrations/`) are a sandbox artefact. Should a `.gitignore`/clean-up step or the runner prevent them? I did not touch runner tooling (outside my scope).
