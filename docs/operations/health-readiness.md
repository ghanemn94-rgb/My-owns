# Health, readiness and logs (§19 item 7, REQ-S19-010; P1 increment)

## Endpoints (API process; implemented by T-DG1-BE, `apps/api/src/modules/platform/health.ts`)

| Endpoint | Meaning | Healthy response | Unhealthy |
|---|---|---|---|
| `GET /healthz` | **Liveness**: the process serves HTTP. It checks no dependencies, so a database outage does not make the orchestrator restart-loop the API | `200 {"status":"ok"}` | no response |
| `GET /readyz` | **Readiness**: the database is reachable (as `mth_app`) **and** uses the `UTF8` encoding **and** every migration shipped with this build is applied with the same checksum | `200 {"status":"ready","checks":{"database":"ok","migrations":"ok"}}` | `503 {"status":"not_ready","checks":{…}}` with `database: fail` (unreachable, or not UTF8: the log line says `the database must use UTF8 encoding (found …)`), or `migrations: pending` / `fail` (checksum drift or unknown migration) |

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
| `mth migrate` | 0 applied or already up to date · 1 failure (nothing half-applied: each file runs in its own transaction). A non-UTF8 database is refused before anything is created: `the database must use UTF8 encoding (found SQL_ASCII)` |
| `mth api` / `mth worker` | 78 invalid configuration (the message names the variable, never its value) · 1 startup failure |
| `mth health /readyz` | 0 ready · 1 not ready or unreachable · 64 bad argument |

## Logs

- API: pino JSON lines on stdout. Credentials are redacted (`authorization`, `cookie`, `set-cookie`), and every
  request carries a request ID. The worker writes JSON lines on stdout.
- Compose keeps container logs with the `json-file` driver, rotated at 10 MB × 5 files per container. Production log
  shipping and monitoring belong to the production deployment guide (§19 item 8, later stage).
- Metrics endpoints are not part of P1.

## Shutdown and connection limits (T-DG2-BE16)

The API process (`mth api`, `node dist/main.js`) stops on `SIGTERM` or `SIGINT`:

1. It stops accepting connections and closes idle keep-alive connections at once.
2. Requests already in flight get a **grace period of 5 s** (`DEFAULT_SHUTDOWN_GRACE_MS`) to finish. Their responses
   carry `Connection: close`.
3. When the grace period ends, every connection still open is destroyed. Typical causes are a stalled upload, or a
   client that sends nothing more. The log line `shutdown grace period elapsed: closing the remaining connections`
   (level warn) gives the number destroyed.
4. **Handlers finish their cleanup (T-DG2-BE18A).** The process waits until every request handler still running has
   settled, including its error handling and cleanup. A request cut off in step 3 is the usual case: an evidence upload
   that was still receiving its body closes its file and removes its temporary `.part` object here. A denied-mutation
   audit event that is still being written also completes. This wait is bounded at **3 s** (`SHUTDOWN_SETTLE_MS`).
   If handlers are still running after it, the log line `shutdown: request handlers still running after the settle
   period; closing the database anyway` (level warn) gives their number.
5. The database pool is closed and the process exits 0, logging `shut down`. As a backstop, if this hasn't happened
   10 s after the signal, the process logs `shutdown did not finish in time; exiting` and exits 1.

The order is therefore: stop accepting, grace (≤ 5 s), destroy the remaining connections, wait for handlers to settle
(≤ 3 s), close the pool, exit. The backstop (10 s from the signal) bounds all of it. In practice the settle step takes
milliseconds, and a stalled upload's shutdown takes about 5 s.

**The trade-off.** An in-flight request that needs more than 5 s after the signal is cut off. This applies, for
example, to a large evidence upload on a slow link. Its transaction rolls back, and no partial evidence object is
kept: neither a final object nor a temporary `.part` file. The client must retry the upload. Compose's default stop
timeout (10 s, after which it sends `SIGKILL`) leaves room for the whole sequence.

**Leftovers after a crash: the start-up sweep (T-DG2-BE18A).** A `SIGKILL`, a crash or a power loss can still leave
an upload's temporary `.part` object behind, because no handler gets to clean up. Each API instance therefore sweeps
the filesystem evidence store once it has started, in the background:

- It removes only temporary objects: files named `<uuid>.part`, exactly where upload keys put them
  (`<organization>/<transformation>/<evidence>/`). It never removes a final object, whatever its age. It doesn't follow
  symbolic links.
- It removes a temporary only if it was last written **more than 1 hour ago** (`STALE_TEMPORARY_AGE_MS`). A live upload
  owns its temporary for at most about 6 minutes: the body must arrive within the 300 s request timeout, and every
  write refreshes the file's modification time. The commit step that follows is bounded by the 10 s pool checkout and
  the 30 s statement and idle-in-transaction timeouts. Shutdown adds at most 10 s. One hour is well above that, on any
  instance that shares the store, and leaves room for clock differences between hosts.
- Each removal is logged at info level as `evidence store: stale temporary object removed`, with the object's key,
  size and age, never its content. The summary line `evidence store: start-up sweep of stale temporary objects
  finished` gives the number removed and the number of younger temporaries it kept.
- A temporary that is younger than 1 hour at start-up is kept, and removed by a later start-up. There is no periodic
  sweep while the instance runs.

Connection rules while the API is running:

- **Unread request bodies.** A response sent before the request body has been received completely carries
  `Connection: close`. Examples are an over-limit upload (413), a refusal before the body is read
  (401/403/404/409/428/400/422), a JSON body over the limit, a media-type refusal, an unmatched route, and a malformed
  URL. The server shuts down its side of the connection after the response and destroys the connection 0.5 s later,
  at most 2 s later. It never reads the rest of the body.
- **Request timeout.** A request whose headers and body don't arrive completely within **300 s** (Node's
  `requestTimeout`) is answered with 408 `request_timeout` and its connection is closed.
- **Rate limiting.** Requests to unmatched routes count against the same per-minute limit as every other request,
  and so does the SPA fallback page. Once the limit is reached they are answered with 429 `rate_limited`.

## Database connections and incomplete request bodies (T-DG2-BE17)

**No client I/O while a database connection is held.** No request handler waits for the client while it holds a
pooled database connection or an open transaction:

- **Evidence upload** (`POST …/evidence/{evidenceId}/content`). The API checks the request (access, the item, `If-Match`,
  the file name) in a short transaction and commits it. Then it receives the body into a temporary file holding no
  database connection. Finally it writes the content in a second short transaction. That transaction authorises the
  upload again at commit time (T-DG2-BE18): it re-checks the session and reloads the caller's grants. If the session
  ended while the body was arriving (logout, revocation, idle or absolute expiry, a disabled user), the answer is 401
  `unauthenticated`. If the caller lost the right to edit the item, it is 403 `forbidden`, audited as
  `authorization.denied`. It then locks the item and checks `If-Match` again. If the item changed while the body was
  arriving, the answer is 409 `version_conflict`. In every refusal the received bytes are discarded. A slow or stalled upload therefore costs one socket and one file handle, never a
  database connection or a row lock.
- **Evidence download** (`GET …/content`). The metadata query's connection is released before the file is streamed,
  so a slow reader holds no database connection.

**Pool bounds** (`packages/db` `createPool`, used by the API, the worker and the `mth-db` CLI pools):

| Setting | Value | Effect when it is reached |
|---|---|---|
| `connectionTimeoutMillis` (`DEFAULT_CONNECTION_TIMEOUT_MS`) | 10 s | A request that waits this long for a pooled connection is answered 503 `unavailable` (logged at error level as `request failed`). `/readyz` answers its usual 503 `not_ready`. A worker job fails and is retried with backoff. Nothing hangs. |
| `idle_in_transaction_session_timeout` (`DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS`) | 30 s | PostgreSQL ends a session that sits inside an open transaction without running a statement for this long. The transaction rolls back and its locks are released, and the pool discards the connection. |
| `statement_timeout` (`DEFAULT_STATEMENT_TIMEOUT_MS`) | 30 s | Unchanged. It limits a single statement. It does not cover idle time inside a transaction, which is why the setting above exists. |

The API pool has 20 connections and the worker pool 5. `mth-db migrate` uses its own single connection, so neither
setting applies to it. The settings are code constants (`PoolOptions` overrides them per pool); there is no
environment variable for them yet.

**Incomplete request bodies.** A request whose body was not received completely is answered (if the client is still
there) with 400 `validation.malformed_request`, and logged at info level as `request body not received completely`.
This applies to every route and media type, whether the client disconnected or the 300 s request timeout cut the
connection. Such a request is never logged as an error and never answered 500. A server fault in the same moment (for
example, the database connection resetting) is still a 500 with an error-level log line.
