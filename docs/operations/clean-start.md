# Clean start (§19 item 7, REQ-S19-010; A18 first case)

Two supported paths. **A** is the target for IT: containers only, no Node.js needed on the host. **B** needs no container
runtime and exercises the same image layout, entrypoint, database initialization and smoke test. B is also the path used
for the evidence in environments without a Docker daemon.

> Compose is for reproducible install and test, **not** a high-availability production topology (see
> [README](README.md)).

## Prerequisites

| | A: Compose | B: container-free |
|---|---|---|
| Host | Docker Engine 23+ with the Compose v2 plugin (tested syntax: Compose v5.1.1); `bash`, `openssl`; Node.js ≥ 22.18 only for the helper scripts | Node.js ≥ 22.18, pnpm 10.33.0 (Corepack), PostgreSQL ≥ 16 server binaries and `psql`, `bash`, `openssl`, `curl` |
| Network | Pulling images and the build's package install need a registry: public, or IT's mirror ([restricted-network.md](restricted-network.md)). **Runtime needs none.** | Dependency install needs the npm registry or a populated pnpm store (`MTH_PNPM_OFFLINE=1`). Runtime needs none. |
| Resources measured | Not measured (Docker unavailable in the build sandbox; see the handback) | 4 vCPU / 15 GiB host: see timings below |

## A. Docker Compose

From a fresh checkout, at the repository root:

```bash
deploy/scripts/init-secrets.sh             # random local secrets OUTSIDE the repo (~/.config/mth-compose/secrets, 0700)
deploy/scripts/build-image.sh              # builds and verifies mth-app:local (non-root, commands, no npm at runtime)
docker compose -f deploy/compose/compose.yaml --profile test-idp up -d
docker compose -f deploy/compose/compose.yaml ps  # api "healthy"; migrate "exited (0)"; db "healthy"
curl -fsS http://127.0.0.1:3000/readyz     # {"status":"ready","checks":{"database":"ok","migrations":"ok"}}
```

What happens, in order:

1. `db` (PostgreSQL 18) initializes an empty volume. `db-init/10-mth-roles.sh` creates the `mth_owner` and `mth_app`
   login roles (passwords from secret files) and the database `mth` owned by `mth_owner`. The health check turns
   healthy only after this has finished.
2. `migrate` runs once as `mth_owner` (`mth migrate`). It applies the forward-only migrations under an advisory lock
   and exits 0. On an up-to-date database it prints `database is up to date`.
3. `api` and `worker` start only after `migrate` has **completed successfully**. Both run as `mth_app`. The API's
   health check calls `/readyz`.
4. With `--profile test-idp`, `keycloak` starts the **test** realm `mth-test` over HTTPS (`https://keycloak:8443`)
   with a throwaway certificate created by `init-secrets.sh`.

**First organization and administrator.** A production database starts empty: no demo data, no default admin. The
first organization and its access/technical administrator are created once, bound to an IdP identity
`(issuer, subject)`:

```bash
docker compose -f deploy/compose/compose.yaml run --rm migrate db bootstrap \
  --org-code MOBILY --org-name-en "…" --org-name-ar "…" --admin-name "…" --admin-email admin@corp.example \
  --admin-issuer https://<corporate-idp>/… --admin-subject <subject of that person at the IdP>
```

It refuses to run a second time. The administrator gets `ADM_ACCESS` and `ADM_TECH` only: **no business role and no
business approval**. Business roles are granted afterwards through the application, and every grant is audited.

**Smoke test (login, create, read).** With the test realm, bootstrap against the synthetic `smoke.admin` subject, then
run the in-network smoke service:

```bash
docker compose -f deploy/compose/compose.yaml run --rm migrate db bootstrap --org-code MTH-TEST \
  --org-name-en "Test org (synthetic)" --org-name-ar "مؤسسة اختبار (اصطناعية)" --admin-name "Synthetic Access Admin" \
  --admin-issuer https://keycloak:8443/realms/mth-test --admin-subject 5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001
docker compose -f deploy/compose/compose.yaml --profile test-idp --profile smoke run --rm smoke
```

The smoke test signs in `smoke.admin` and `smoke.office` through the Keycloak login form (authorization code + PKCE).
The admin creates a business unit and grants the office user `TO`. The office user creates a transformation and reads
it back (detail, list, audit). The test then confirms that the technical admin cannot see that record, and both users
sign out. It ends with `{"smoke":"PASS",…}`.

**Everything at once, including the no-egress variant:** `deploy/scripts/verify-stack.sh` builds the image, runs the
default and the `internal: true` variants in a private project with throwaway secrets, runs bootstrap and the smoke
test in each, checks that the worker consumed the `transformation.created` event, prints record counts and tears
everything down. Exit 0 means PASS, exit 3 means BLOCKED (no Docker daemon).

**Stop / reset:** `docker compose -f deploy/compose/compose.yaml --profile test-idp down` keeps the data;
`… down -v` deletes the database and evidence volumes.

## B. Container-free (same layout, same entrypoint)

```bash
deploy/scripts/clean-start-local.sh            # clones HEAD into a temp dir, installs, builds, assembles, runs A1–B5
# options: --include-worktree (overlay uncommitted files), --keep, --work DIR, --log FILE
# environment: PGBIN, MTH_PNPM_STORE, MTH_PNPM_OFFLINE=1, MTH_LOCAL_PG_PORT (24340), MTH_LOCAL_PORT (3100),
#              MTH_LOCAL_PG_STRICT_PORT, MTH_LOCAL_STRICT_PORT (see "Harness port policy" below)
```

It runs `deploy/scripts/assemble-runtime.sh`, which is the same script as the image build, so the runtime tree
matches the image. It then runs the image's `entrypoint.sh` with `MTH_APP_ROOT` pointing at that tree. The steps are:

| Step | Checks |
|---|---|
| A1–A2 | `mth db status` = 3 (pending) on an empty DB. `mth migrate` applies every shipped migration in `packages/db/migrations/` (currently 9: `0001`–`0009`), a re-run is a no-op, then status = 0 |
| A3 | `mth db seed-dev` is refused (64): dev seeds are not in the image. `AUTH_MODE=dev` with `NODE_ENV=production` exits 78 |
| A4–A5 | api + worker in production mode (OIDC). `/healthz` and `/readyz` are ready. `GET /` serves the SPA. The dev login is 404. An unreachable IdP makes login redirect to `/login?error=idp_unavailable` without crashing. `/me` without a session is 401 |
| A6 | `mth db bootstrap` creates the first organization and admin. A second bootstrap is refused |
| B1–B3 | On a second fresh database: SYNTHETIC dev users (source tree only), then `smoke.mjs` in dev mode: 11 steps |
| B4–B5 | The worker relays and consumes `transformation.created` (outbox published, ledger row). Record counts |

## Measured timings (container-free path B)

Recorded 2026-09-30 in the build sandbox: 4 vCPU, 15 GiB RAM, Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 (local
floor version; Compose uses 18). Offline install from a pre-populated store. Workload: one fresh clone, 6 migrations (the count at the time of measurement),
1 organization, 4 business units, 6 users, 1 transformation.

| Step | Seconds |
|---|---|
| fresh clone | 2.1 |
| install (frozen lockfile, offline store) | 1.2 |
| `pnpm -r build` | 14.1 |
| assemble runtime tree (notices, prod prune, copy, verify: 129 packages, 100 MB) | 1.9 |
| PostgreSQL cluster + roles | 0.8 |
| migrate + production checks + bootstrap (A1–A6) | 2.4 |
| first-case journey + worker consumption (B1–B5) | 3.2 |
| **total** (incl. environment facts and teardown) | **27.0** |

Source: `docs/delivery/handbacks/DG1/T-DG1-DEVOPS-evidence/clean-start-local.log` (an earlier identical run took
30.7 s; build time dominates).

The Compose timings (image build, `up` to healthy, Keycloak start) have **not** been measured: the build sandbox has no
Docker daemon. `verify-stack.sh` prints them when run on a Docker host.

## Harness port policy

This applies to every script that starts a disposable PostgreSQL cluster and, in most cases, an API (F-DG2-310). One
shared helper, `tests/qa/support/pg-port.sh`, holds the logic, so it cannot drift between the scripts.

**Why.** Linux gives client sockets (psql, curl, the API's database pool) a local port from the *ephemeral range*,
`/proc/sys/net/ipv4/ip_local_port_range` (32768–60999 by default). When a client closes first, its socket stays in
`TIME_WAIT` for about 60 s. If a server then binds that port, the bind fails with `EADDRINUSE`, even with
`SO_REUSEADDR`, because the client socket never set it. The old defaults (54331–54371) were inside that range, so
about one run in six failed with `BLOCKED: disposable PostgreSQL did not start`.

**Defaults.** Every default port is below 32768, and each harness has its own:

| Harness | PostgreSQL port variable (default) | API port variable (default) | Strict flags |
|---|---|---|---|
| `tests/qa/support/with-pg.sh` (integration tests) | `QA_PG_PORT` (24351) | none | `QA_PG_STRICT_PORT` |
| `apps/web/e2e/support/with-stack.sh` (web journeys) | `E2E_PG_PORT` or `QA_PG_PORT` (24331) | `E2E_API_PORT` (3000) | `E2E_PG_STRICT_PORT`, `E2E_API_STRICT_PORT` |
| `e2e/support/qa-stack.sh` (acceptance e2e) | `QA_E2E_PG_PORT` (24361) | `QA_E2E_API_PORT` (3060; previously a fixed 3000) | `QA_E2E_PG_STRICT_PORT`, `QA_E2E_API_STRICT_PORT` |
| `e2e/clean-start/a18-clean-start.sh` | `QA_A18_PG_PORT` (24371) | `QA_A18_PORT` (3181) | `QA_A18_PG_STRICT_PORT`, `QA_A18_STRICT_PORT` |
| `deploy/scripts/clean-start-local.sh` (path B) | `MTH_LOCAL_PG_PORT` (24340) | `MTH_LOCAL_PORT` (3100) | `MTH_LOCAL_PG_STRICT_PORT`, `MTH_LOCAL_STRICT_PORT` |

The API defaults (3000–3181) were already outside the ephemeral range. They are only exposed when someone sets a port
inside it, and the retry below covers that case too.

**Retry.** The requested port, whether the default or from the environment, is only the *starting point*. A warning
is logged if it lies inside the ephemeral range. The service is started, and the harness waits until that process is
ready. For PostgreSQL, "ready" means its own log says "ready to accept connections". For an API, the process must be
alive and its health endpoint must answer. If the process exits because the bind failed (`Address already in use` or
`EADDRINUSE` in its log), or something already accepts connections on the port, the harness picks a random port from
`MTH_PORT_POOL` (default `25000-31999`). It skips the ephemeral range, ports already tried, and any port with a socket
in any state in `/proc/net/tcp{,6}`. It tries again up to `MTH_PORT_RETRIES` more times (default 10), and logs every
retry on stderr:

```
port-policy: PostgreSQL: port 24351 is in use (EADDRINUSE; attempt 1 of 11); retrying on port 26616
port-policy: PostgreSQL listening on port 26616 (attempt 2)
```

Every URL the harness exports or writes uses the port actually in use: `TEST_DATABASE_ADMIN_URL`, `DATABASE_URL`,
`DATABASE_OWNER_URL`, the secret URL files, `PORT`, `APP_BASE_URL` and `E2E_BASE_URL` (which Playwright reads).

**Strict mode.** With the harness's `*_STRICT_PORT=1`, or `MTH_STRICT_PORT=1` for all of them, a port conflict is not
retried. The run stops with `BLOCKED: … is in use … forbids another port` and exit 3.

**Never a silent pass.** Only bind conflicts are retried. Any other failure is reported as before:
- PostgreSQL that does not start for another reason, or retries that run out: `BLOCKED: …`, exit 3.
- An API that exits or does not become ready for another reason: exit 4 in `with-stack.sh` and `qa-stack.sh`, and
  `FAIL`/exit 1 in `a18-clean-start.sh` and `clean-start-local.sh`, where API startup is the thing being checked.

**Regression check.** `tests/qa/support/port-collision-check.sh` puts a client socket into TIME_WAIT on a chosen port
and proves the collision: state 06 in `/proc/net/tcp`, and a `SO_REUSEADDR` bind fails with `EADDRINUSE`. It then
shows four things. The pre-fix `with-pg.sh` fails closed (the negative control). The current one retries and starts,
both from an old in-range port and from the new default. Strict mode is BLOCKED. The generic API path retries a Node
HTTP server. Exit 0 means every case behaved as expected.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `required variable MTH_SECRETS_DIR is missing a value` | Run `deploy/scripts/init-secrets.sh` (it writes `deploy/compose/.env`, which is git-ignored, with only that path) |
| `pull access denied for mth-app` | Build the image first (`deploy/scripts/build-image.sh`), or set `MTH_APP_IMAGE` to IT's registry image and `MTH_APP_PULL_POLICY=missing` |
| `migrate` exited 1 with `checksum` | An applied migration file differs from this build. Never edit applied migrations; restore from backup and add a corrective migration (ADR-0003) |
| api exits 78 | Invalid configuration: the message names the variable (never its value) |
| `/readyz` 503 `migrations: pending` | `migrate` has not run against this database |
| `mth-db: the database must use UTF8 encoding (found SQL_ASCII)`, or `/readyz` 503 `database: fail` with that log line | The database was created without `ENCODING 'UTF8'` (for example by an `initdb` run with no `LANG`/`LC_*`). The encoding cannot be changed in place: re-create it with `CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0` (ADR-0003 "Database encoding") |
| Login redirects to `/login?error=idp_unavailable` | The API cannot reach `OIDC_ISSUER_URL` (discovery is lazy and retried; the API keeps running) |
