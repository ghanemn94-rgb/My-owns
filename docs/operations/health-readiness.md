# Health, readiness and logs (§19 item 7, REQ-S19-010; P1 increment)

## Endpoints (API process; implemented by T-DG1-BE, `apps/api/src/modules/platform/health.ts`)

| Endpoint | Meaning | Healthy response | Unhealthy |
|---|---|---|---|
| `GET /healthz` | **Liveness**: the process serves HTTP. It checks no dependencies, so a database outage does not make the orchestrator restart-loop the API | `200 {"status":"ok"}` | no response |
| `GET /readyz` | **Readiness**: the database is reachable (as `mth_app`) **and** every migration shipped with this build is applied with the same checksum | `200 {"status":"ready","checks":{"database":"ok","migrations":"ok"}}` | `503 {"status":"not_ready","checks":{…}}` with `database: fail`, or `migrations: pending` / `fail` (checksum drift or unknown migration) |

Both are public, never rate-limited, and return no configuration or secret data. Route traffic to an instance only
while `/readyz` is 200.

## In containers

- The image has no curl. `mth health [/healthz|/readyz]` runs `/app/healthcheck.mjs`, which makes a loopback-only
  request and exits 0 only on a 2xx. Compose uses `mth health /readyz` for `api` (interval 10 s, timeout 6 s,
  12 retries, 20 s start period).
- `db` is healthy when `pg_isready` succeeds over TCP. That happens only after first-start initialization has created
  the roles and the `mth` database.
- `migrate` is a one-shot service: `api` and `worker` start only after it `completed_successfully`.
- `worker` has **no HTTP endpoint in P1**. Its liveness is the process itself (`restart: unless-stopped`) plus its
  structured logs (`mth-worker started`, pg-boss errors). A worker health probe (for example a heartbeat row that
  readiness can check) is a recorded follow-up for the backend owner. Until then, "worker running" is not proof that
  jobs are flowing. `verify-stack.sh` and `clean-start-local.sh` check it by observing the `processed_message` ledger
  row for the smoke transformation.
- `keycloak` (test profile only) is checked by opening its HTTPS port. The smoke test additionally waits for the
  realm's discovery document.

## CLI checks

| Command | Exit codes |
|---|---|
| `mth db status` | 0 up to date · 3 pending · 4 drift (changed or unknown applied migration) |
| `mth migrate` | 0 applied or already up to date · 1 failure (nothing half-applied: each file runs in its own transaction) |
| `mth api` / `mth worker` | 78 invalid configuration (the message names the variable, never its value) · 1 startup failure |
| `mth health /readyz` | 0 ready · 1 not ready or unreachable · 64 bad argument |

## Logs

- API: pino JSON lines on stdout. Credentials are redacted (`authorization`, `cookie`, `set-cookie`), and every
  request carries a request ID. The worker writes JSON lines on stdout.
- Compose keeps container logs with the `json-file` driver, rotated at 10 MB × 5 files per container. Production log
  shipping and monitoring belong to the production deployment guide (§19 item 8, later stage).
- Metrics endpoints are not part of P1.
