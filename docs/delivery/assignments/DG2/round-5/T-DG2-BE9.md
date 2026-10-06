# Assignment T-DG2-BE9: require a UTF8 database; make the disposable test clusters locale-independent (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`, with BE8 `9b4ded0` and FE7 `6946a1e` integrated. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019 (add no migration for this), `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## What the orchestrator found
The orchestrator re-verified the integrated round-5 tree with `LANG` and `LC_ALL` **unset**. Integration was 473/474. Your BE8 test `oidc.test.ts > a name with astral characters at the 200 boundary is cut on a code-point boundary (F-DG2-181)` failed: `app_user.display_name CHECK (char_length(display_name) BETWEEN 1 AND 200)` rejected a 200-code-point name. That gave a 422 the contract does not declare.

The cause:
- `tests/qa/support/with-pg.sh` runs `initdb` with no encoding or locale, so the disposable cluster takes the shell locale. With no locale it becomes **SQL_ASCII** (`show server_encoding`), where `char_length` counts **bytes**.
- With `LANG=C.UTF-8` the same script gives **UTF8**, and the test passes. That is presumably what your sandbox had.
- `apps/web/e2e/support/with-stack.sh` and `e2e/support/qa-stack.sh` have the same problem: they run `initdb` and then `CREATE DATABASE mth` with no encoding.
- `packages/db/test/global-setup.ts` creates `mth_test` with a plain `CREATE DATABASE`.

So the test results depend on the developer's locale. Production (`postgres:18` image, compose and CI) is UTF8 by default, but **nothing in the product refuses a non-UTF8 database**. On a SQL_ASCII database every length limit counts bytes, which breaks Arabic text: a 120-character Arabic name is about 240 bytes. Non-ASCII data is not validated as UTF-8 either.

## Required
1. **Fail closed in the product.**
   - `mth-db migrate` (and `bootstrap`/`seed-dev`, which share the connection path) must check `SHOW server_encoding` before doing anything. If it is not `UTF8`, refuse with a clear error, for example `mth-db: the database must use UTF8 encoding (found SQL_ASCII); create it with ENCODING 'UTF8'`, and a non-zero exit. Nothing is applied.
   - The API's readiness check (`/readyz`) must also report not-ready on a non-UTF8 database, if readiness already queries the database. Keep it cheap: query once at startup, or cache the result.
   - Document the requirement in the relevant P1/P2 data-model ADR and in `docs/architecture/data-dictionary.md`, or in the operations/runbook doc that covers database provisioning.
2. **Make the harnesses deterministic.** Set the encoding explicitly so the shell locale no longer matters:
   - `tests/qa/support/with-pg.sh`, `apps/web/e2e/support/with-stack.sh` and `e2e/support/qa-stack.sh`: use `initdb --encoding=UTF8 --locale=C` (or `C.UTF-8` if you have a reason; say which you chose and why).
   - Any `CREATE DATABASE` in these scripts and in `packages/db/test/global-setup.ts`: create it with `ENCODING 'UTF8' TEMPLATE template0` (and an explicit `LC_COLLATE`/`LC_CTYPE` consistent with `initdb`).
   - **Sweep** the repository for every other place that runs `initdb` or `CREATE DATABASE` (scripts, tests, deploy, docs) and handle each one the same way. List them in the handback.
3. **Tests.**
   - An integration test that the test database's `server_encoding` is `UTF8`.
   - An integration test that `mth-db migrate` refuses a database created with `ENCODING 'SQL_ASCII' TEMPLATE template0` in the disposable cluster: non-zero exit, the message, and no `schema_migrations` row or table created.
   - If readiness gains the check, a test for it.
   - The F-DG2-181 astral test passes in **both** shell settings.

## Self-verification (real output in the handback)
Run the full suites **twice**: once with `LANG` and `LC_ALL` explicitly unset (`env -u LANG -u LC_ALL ...`) and once with `LANG=C.UTF-8`.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (plus the `--ignore-path` variant if only sandbox-masked dotfiles fail)
- `pnpm openapi:lint`
- `pnpm test` on Node 22 **and** 24
- the integration suite (`QA_PG_PORT=55471`) in both locale settings, including `contract.test.ts` (161 ops), `oidc.test.ts` and `blank-text.test.ts`
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`, unique ports) in both locale settings
- `e2e/support/qa-stack.sh` starts a UTF8 stack (show `server_encoding` in the log)
- `node tools/gates/validate.mjs --historical --stage DG1` (exit 0)
- a negative control: the new tests fail on the old code

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE9-backend-workflow-engineer.md` with the fix, the files changed, the sweep list and every check's real output in both locale settings. Keep the evidence to logs only.
