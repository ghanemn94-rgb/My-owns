# Monitoring: health, worker heartbeat, operational exceptions, alerts, structured logs and redaction (P6)

This guide is for Mobily IT operators and the delivery team's reviewers. It describes what the platform emits for
monitoring and what IT connects it to. Sources: ADR-0053 §4–§7 (slice J), ADR-0052 §5 (`SecretProvider`), ADR-0011
(health and readiness). Requirements: REQ-S16-029 ("never expose secrets or private evidence URLs … in logs"),
REQ-S12-019 (operational exceptions), acceptance A22 (operational readiness).

> **Scope and honesty.** Everything here was exercised on a local build and in the test suites: a disposable
> PostgreSQL 16 cluster and, in CI, a PostgreSQL service container. That is **not** proof of high-availability
> production monitoring. The product ships **no** log shipper, metrics backend, paging integration or dashboard, and it
> has no `/metrics` endpoint. IT connects the log stream described below to its own tooling, and nothing here is
> "integrated with Mobily monitoring". An operational exception, and acknowledging one, approves nothing. It is not a
> business approval (G1–G6) and has nothing to do with the engineering delivery gates (DG0–DG7).

## 1. Signals at a glance

| Signal | Where | Healthy | Unhealthy |
|---|---|---|---|
| API liveness | `GET /healthz` (public) | `200 {"status":"ok"}` | no answer: restart the container |
| API readiness | `GET /readyz` (public) | `200`: database reachable, UTF8, every migration applied | `503` with the failing check ([health-readiness.md](health-readiness.md)) |
| Worker heartbeat | `worker_heartbeat` table; `GET /api/v1/admin/operations/heartbeat` (`operations.read`); Administration > Operations | `alive`: newest beat ≤ 90 s old | `stale`: newest beat > 90 s old · `unknown`: no worker ever beat |
| Operational exceptions | `GET /api/v1/admin/operations/exceptions` (`operations.read`); Administration > Operations | no `open` exception | one active exception per source and failure class (`job_failed`, `connector_*`, `data_stale`, `heartbeat_missed`) |
| Alert lines | stdout of `mth api` and `mth worker`, JSON, `"alert":true` | none | one line per **opened** exception (not per recurrence) |

`unknown` and `stale` are never shown as alive. A stale KPI keeps its last value and date with the Stale label. It is
never shown as 0 or green.

## 2. Worker heartbeat (ADR-0053 §6)

- **Writer** (`apps/worker/src/heartbeat.ts`, started by `apps/worker/src/main.ts` after the handlers are
  registered). Each worker process picks a random instance key at start (`worker-<24 hex>`, logged in the
  `mth-worker started` line). It inserts one row with beat 1, then moves that row forward by exactly one beat every
  `WORKER_HEARTBEAT_SECONDS`.
  - Times use the database clock, the same clock the API reads.
  - A beat is telemetry. It writes no audit event.
  - A failed beat logs `worker heartbeat failed` (level error, `errorCode: "worker.heartbeat_failed"`), and the next
    tick retries it. It never stops the worker.
  - A restarted worker writes a new instance key. The old row stays as history and turns stale.
- **`WORKER_HEARTBEAT_SECONDS`**: integer 1–30, default 30. The API's rule is fixed at 90 s, three default intervals.
  The maximum of 30 keeps at least three beats inside that window, so a healthy worker is never reported stale
  because of its configuration. Compose does not set the variable, so the default applies.
- **Status** (`getWorkerHeartbeat`): `alive` / `stale` / `unknown`, and up to 50 instances with their own status.
- **Watch** (API process, every 60 s). When the newest beat is older than 90 s, the watch opens the platform
  exception `worker:worker:heartbeat_missed`, or counts a recurrence if it is already open. It resolves the exception
  as `recovered` when beats resume. With no beat at all (`unknown`), it raises nothing; the card shows Unknown.
- **Operator check** (read only, as any role with `SELECT` on the table):

  ```sql
  SELECT instance_key, app_version, queue_count, beat_count, last_beat_at, now() - last_beat_at AS age
    FROM worker_heartbeat ORDER BY last_beat_at DESC LIMIT 5;
  ```

  If `age` is above 90 s on every row, the worker is down or cannot reach the database. Check
  `docker compose logs worker`, or the worker's stdout, for `worker heartbeat failed` or a start-up error (exit 78
  means invalid configuration, and the message names the variable).

## 3. The alert sink: what IT routes

The platform's alert sink is its **structured log stream**. Opening an operational exception writes one line at level
`error` (pino level 50 in the API) with:

```json
{"level":50,"time":1793242422273,"alert":true,"alertCode":"heartbeat_missed","exceptionId":"…","errorCode":"operations.heartbeat_missed","msg":"operational exception opened"}
```

- `alertCode` is the exception's failure class (`job_failed`, `connector_run_failed`, `connector_unreachable`,
  `connector_credentials_rejected`, `data_stale`, `heartbeat_missed`). A recurrence writes no alert line. The
  exception's `occurrence_count` grows instead.
- At the same opening, the active holders of `operations.acknowledge` at the exception's organization scope get an
  in-app notification (all organizations' holders for a platform exception), with dedupe key
  `operational_exception:<id>:opened:<userId>`. When an email channel is configured, email follows through the
  notification fan-out ([ADR-0054 §3](../architecture/adr/ADR-0054-p6-identity-storage-notification-channels.md)).
- **Delivery status in this build:** the API's heartbeat watch writes the `heartbeat_missed` alert line. The alert
  line and in-app notification for the other failure classes belong to T-DG6-BE-K2 (p6-work-split §J/C.4). Verify
  them on the release candidate before relying on them.
- **What IT configures:** a log-shipper rule on the API and worker containers' stdout that forwards lines with
  `"alert":true` to the on-call channel, keyed by `alertCode`. A second rule should page when the heartbeat endpoint
  reports `stale`, or when `/readyz` fails for more than 2 minutes. The product does not choose or bundle the
  shipper.
- Compose keeps container logs with the `json-file` driver, rotated at 10 MB × 5 files. To list the alerts of a local
  stack: `docker compose -f deploy/compose/compose.yaml logs api worker | grep '"alert":true'`.

## 4. Structured logs (ADR-0053 §4)

Every API and worker log line is one JSON object with `time`, `level` and `msg`. Where known, it also carries
`requestId`, `jobId`, `queue`, `serviceIdentity`, `organizationId` and `errorCode`. Request and response bodies are
never logged. The API logs through pino (`apps/api/src/server.ts`). The worker writes JSON lines through `console`,
and `apps/worker/src/main.ts` routes them through the same redactor.

### 4.1 The redaction list

One process-wide redaction set (`packages/config/src/load.ts`) is applied to every line before it is written: pino's
`hooks.streamWrite` in the API, and `installConsoleRedaction` in the worker.

| Class | What is censored | Printed as |
|---|---|---|
| Secrets | every value resolved through a `SecretProvider` (the registry is wrapped by `withSecretRedaction` in `server.ts` and `main.ts`); every secret variable `loadConfig` reads (`DATABASE_URL`, `DATABASE_OWNER_URL`, `OIDC_CLIENT_SECRET`, `MTH_DEMO_ADMIN_DATABASE_URL`) and the password inside a postgres URL. The JSON-escaped and percent-encoded forms are censored too. Values shorter than 4 characters are not registered | `[secret]` |
| Storage fields | the keys `storageKey`, `storage_key`, `key`, `Key`, `Bucket`, `bucket`, `endpoint` and every `s3_*` key, at any depth of a JSON line | `[redacted]` |
| Storage URLs | any URL on a registered object-store host (`registerRedactedStorageEndpoint`, called where the S3 adapter is configured) | `[storage-url]` |
| Storage paths | any absolute path under `EVIDENCE_STORAGE_PATH` | `[storage-path]` |
| Signed-URL parameters | `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token` | removed from the URL |
| Header tokens | `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-csrf-token"]`, `res.headers["set-cookie"]`, `req.headers["x-mth-signature"]` (pino `redact` paths) | `[redacted]` |
| URL tokens | the deep-link token segment `/links/<token>`; the OIDC parameters `code`, `state`, `id_token`, `access_token` and `refresh_token` | `/links/[token]`, `code=[redacted]` |
| Credentials patterns | bearer tokens, JWTs, private-key blocks, AWS access-key ids | `[secret]` |

`operational_exception.last_error_message` and `operational_failure.error_message` are redacted before they are
stored. In the worker this is `redactErrorText` in `apps/worker/src/kit.ts`. The API's callers store messages built
from problem codes: the connector run messages and the fixed heartbeat text.

**Limits, stated plainly.** Redaction is pattern- and value-based. A secret that never went through a
`SecretProvider` or `loadConfig`, and that matches no pattern, is not recognised. Code must therefore never log
credentials or bodies; the redactor is a second line of defence. The `key` field is censored wherever it appears,
including harmless uses.

## 5. The post-suite log scan (ADR-0053 §5; REQ-S16-029 acceptance)

`deploy/scripts/log-scan.mjs` reads the log files a test run wrote and fails on any secret or storage leak:

- the API log lines that `apps/api/test/support/harness.ts` writes to `$MTH_TEST_LOG_DIR/api-<pid>.log` when
  `MTH_TEST_LOG_DIR` is set;
- the suite's own output, which carries the worker's console lines.

It never reads `docs/delivery/**` (D-138): a path that is in, or contains, that folder is refused.

It fails (exit 1) on:

- the literal value of every canary: every environment value that starts with `mth-canary-`, plus each `--canary`;
- the patterns `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `AKIA[0-9A-Z]{16}`, `X-Amz-Signature=`, `X-Amz-Credential=`,
  `Bearer [A-Za-z0-9._~+/-]{20,}`, `eyJ[A-Za-z0-9_-]{10,}\.eyJ` and `/links/[A-Za-z0-9_-]{43}`;
- the configured object-store host (`--store-host`, or `MTH_LOG_SCAN_STORE_HOSTS`, comma-separated);
- the `EVIDENCE_STORAGE_PATH` prefix (`--storage-path`, or `EVIDENCE_STORAGE_PATH`).

Each hit is reported as `file:line: <class>: <line with the match masked>`. The matched value is never printed. Exit
0 prints `log-scan: PASS` with the counts of files, lines, canaries and patterns. Exit 2 means **BLOCKED**, never a
pass, in these cases: no input, no log file found, a `docs/delivery` path, an unknown option, or
`--require-canaries` with no canary set.

```bash
export MTH_TEST_LOG_DIR="$TMPDIR/mth-test-logs"
export MTH_CANARY_OIDC_CLIENT_SECRET=mth-canary-oidc-client-secret S3_ACCESS_KEY_ID=mth-canary-s3-access-key \
       S3_SECRET_ACCESS_KEY=mth-canary-s3-secret-key SMTP_PASSWORD=mth-canary-smtp-password
pnpm test:integration 2>&1 | tee "$MTH_TEST_LOG_DIR/integration-output.log"
node deploy/scripts/log-scan.mjs --require-canaries --storage-path "${TMPDIR:-/tmp}/mth-evidence-it-" "$MTH_TEST_LOG_DIR"
```

- **CI** (`deploy/ci/ci.yml`, job `integration`): the PostgreSQL service password is the canary
  `mth-canary-ci-db-password`, so every database URL of the suite carries it. The job sets the canaries above and
  `MTH_TEST_LOG_DIR`, tees the suite output, then runs the scan's self-test (`node --test
  deploy/scripts/tests/log-scan.test.mjs`) and the scan. The scan runs even when the suite failed.
- **Self-test:** `deploy/scripts/tests/log-scan.test.mjs` builds a negative fixture at run time, one line per class,
  so no key-shaped string is committed. It requires FAIL on each line, PASS on a clean redacted run, and BLOCKED on
  the cases above. `pnpm test` runs it through `deploy/scripts/tests/log-scan.vitest.mjs`.
- **What a canary proves.** The database-password canary flows through every connection URL of the suite. The S3,
  SMTP and OIDC canaries are process environment values. The `env` `SecretProvider` resolves them only when a test
  references those names, so for those secrets the scan proves absence from the logs, not exercise of every code
  path.

## 6. What IT sets up for production (residual)

| Item | Owner | Status |
|---|---|---|
| Log shipping from the `api` and `worker` containers' stdout, with retention per Mobily policy | Mobily IT | not provided by the product |
| Alert routing for `"alert":true` lines and for heartbeat `stale` / `/readyz` failure | Mobily IT | rules described in §3; no paging integration shipped |
| Metrics (request rates, latency, pool usage) | Mobily IT / later stage | no `/metrics` endpoint in this release |
| Registering the production object-store endpoint for URL redaction | follows the S3 adapter's configuration (T-DG6-BE-H2) | `registerRedactedStorageEndpoint` is the hook |
| HA (several API/worker instances) | Mobily IT | the heartbeat lists each instance, and the watch tolerates several API instances. Not proven under HA here |
