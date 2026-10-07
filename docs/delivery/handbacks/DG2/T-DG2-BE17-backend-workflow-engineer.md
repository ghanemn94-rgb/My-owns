# Handback T-DG2-BE17 (backend-workflow-engineer): no client I/O inside a database transaction; aborted bodies are never a 500

- **Stage:** P2 / DG2 (FIXING), round-12 repair. **Assignment:** `docs/delivery/assignments/DG2/round-12/T-DG2-BE17.md`
  (sha256 `3de29213…fbbb2`, verified before starting).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-BE17-backend-workflow-engineer-20261007T024144Z-375b9068","session_id":"375b9068-23da-4489-860b-658307ccf11a"}`.
- **Base:** `HEAD` = `18694ca84d3aec3eab24c7ee1fe3d4ea4cb4f76b`. The tracked tree was clean apart from sandbox-masked
  dotfiles. Nothing is committed; the orchestrator integrates.
- **Before implementation:** `node tools/gates/validate.mjs --historical --stage DG1` → exit 0, `PASS gate DG1 (historical)`.
- **Findings repaired:** F-DG2-411 (Medium, REQ-S16-013) and F-DG2-412 (Low, REQ-DLV-034). I can't close them: a
  non-author reviewer verifies the fix, and the orchestrator records `import-findings --fix`.
- **Migrations:** none. **API endpoints added:** none. The contract (`docs/api/openapi.yaml`) and migrations 0001-0019
  are unchanged.
- **Evidence directory:** `docs/delivery/handbacks/DG2/T-DG2-BE17-evidence/` (logs only).
- All test data is SYNTHETIC. G1-G6 are product business gates; nothing here grants or implies one, and nothing here
  implies DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/evidence/routes.ts` | The upload in three phases: checks in a short committed transaction, the body received with no connection held, then a short write transaction that re-checks `If-Match` on the locked row. The route-local `abortedBodyProblem` is removed (one central rule now). |
| `apps/api/src/modules/evidence/store.ts` | `EvidenceStore` gains `receive` (stream into the temporary `.part` object, SHA-256 and size limit while streaming, fsync; removed on any failure) and `finalise` (atomic rename). `put` = `receive` + `finalise`. `discardUncommitted` also removes a `.part`. The S3 stub fails closed for the new methods. |
| `apps/api/src/modules/platform/hooks.ts` | `isIncompleteBodyError` and `incompleteBodyProblem`: the central F-DG2-412 rule in `mapError`, logged at info. A pool checkout timeout maps to 503 `unavailable`. |
| `apps/api/src/modules/platform/index.ts` | Exports the new helpers and types. |
| `packages/db/src/pool.ts` | `connectionTimeoutMillis` (10 s) and `idle_in_transaction_session_timeout` (30 s) on every `createPool` pool; `isPoolCheckoutTimeout`; a per-client `error` listener so a server-side session end on a checked-out client is never an uncaught exception. |
| `packages/db/src/index.ts` | Exports the new constants and `isPoolCheckoutTimeout`. |
| `docs/operations/health-readiness.md` | New section "Database connections and incomplete request bodies (T-DG2-BE17)": the upload/download behaviour, the pool bounds and their values, and the incomplete-body answer. |
| `apps/api/test/integration/request-io.test.ts` (new) | Real-socket integration tests for both findings (§5). |
| `packages/db/test/integration/pool-bounds.test.ts` (new) | The pool bounds against real PostgreSQL; pins pg-pool's timeout messages. |
| `apps/api/src/modules/platform/incomplete-body.test.ts` (new) | Unit tests of the error mapping and its log levels. |
| `apps/api/src/modules/evidence/evidence.test.ts` | Unit tests of `receive` / `finalise` / `discardUncommitted` and the S3 stub. |
| `apps/api/test/support/harness.ts` | `startApi({ pool })`: per-instance pool size, checkout timeout, idle-in-transaction timeout and application name. |

## 2. Behaviour delivered

### F-DG2-411 (REQ-S16-013): no client I/O while a pooled connection or a transaction is held

`POST /api/v1/transformations/{id}/evidence/{evidenceId}/content` (`routes.ts:441-551`) now runs in three phases:

1. **Checks, holding no transaction during the body.** A short transaction (committed, so its connection is
   released, before any body byte is read) runs the same checks in the same order as before:
   - transformation read (404);
   - the item exists in this transformation (404);
   - `openWrite` with `EDIT_OWN` (403, with the denied-mutation audit as before);
   - `X-File-Name` (400 `validation.file_name` / `validation.invalid_character`);
   - `If-Match` present (428) and equal to the current version (409);
   - not archived (422 `record.archived`);
   - `kind = file` (422 `evidence.not_a_file`);
   - a body is present (400 `validation.body_required`) and is the raw byte stream (400 `validation.content_type`).

   This phase reads the row without `FOR UPDATE` (`checkEvidenceVersion(…, false)`, `routes.ts:471`).
2. **The body, holding nothing.** `store.receive(key, body, EVIDENCE_MAX_BYTES)` (`routes.ts:487`) streams into
   `<key>.part`, with the size limit (413 `evidence.too_large`) and the SHA-256 over the raw bytes computed while
   streaming. The file is fsynced. On any failure it removes `.part` and rethrows.
3. **A short write transaction.**
   - `openWrite` again: authorization is re-evaluated at write time, so a grant revoked during the upload is refused.
   - The row lock (`checkEvidenceVersion(…, true)`, `FOR UPDATE`) with **`If-Match` re-checked against the locked
     version**. A concurrent edit during the body gets the declared 409 `version_conflict` with `currentVersion`.
   - The `kind` check again, the next revision number, the `evidence_content` insert, the item update (version + 1,
     review reset) and the `evidence.upload_content` audit event.
   - Then the commit.

   Any error after phase 2 started runs `store.discardUncommitted(key)`, which removes both `.part` and the final
   object.

**Interpretation to confirm: where the object is finalised.** The assignment says "Commit, then finalise the object
exactly as today". Today (HEAD) the rename happens *before* the commit, inside the transaction, and the object is
discarded if the commit fails. I kept that order: `store.finalise(key)` is the last statement inside the write
transaction (`routes.ts:542`), after the audit insert. It is local file I/O only (one `rename`), never client I/O.

- **Why:** a committed `evidence_content` row can never point at an object that is missing because the rename failed
  after the commit. The opposite failure, a renamed object whose commit failed, is discarded in the `catch`.
- **If the orchestrator wants the literal order** (commit, then rename), it is a two-line move. Then a rename failure
  after the commit leaves a content row whose download answers 404.

**Statuses and codes.** Every declared status and problem code is unchanged: 400, 401, 403, 404, 409, 413, 428 and
422, and the existing `evidence.*` and `validation.*` codes. The existing tests show this, all green in the matrix
(§6): `evidence.test.ts`, `connection-hygiene.test.ts` (BE16, 13 tests), `media-types.test.ts`, `invalid-utf8.test.ts`,
`dg2-repairs.test.ts` and the contract suite.

**Sweep: every handler that could await client I/O while holding a pooled connection or a transaction.**

| Handler / path | Before (HEAD 18694ca) | After |
|---|---|---|
| `POST …/evidence/{id}/content` (upload) | `db.transaction()` opened, row locked `FOR UPDATE`, **then** the body streamed (`store.put`) inside the transaction. N stalled uploads (N = pool size) held every connection, idle in transaction, until `requestTimeout` (300 s). Test R8 on HEAD: 5/5 sessions `idle in transaction`; `/me`, `/readyz` and a `PATCH` of the item get no answer in 5 s. | Three phases: no connection is held while the body arrives. R8 after (`sweep-after.log`): 0 of 5 sessions idle in transaction; `/me` 200 in 5 ms, `/readyz` 200 in 3 ms, `PATCH` 200 in 17 ms. |
| `GET …/evidence/{id}/content` (download to a slow reader) | The metadata query runs on `db` outside any transaction (Kysely releases the connection when the query returns), then `reply.send(stream)`. **No connection is held while streaming, already correct.** | Unchanged. A new test proves it: a 24 MiB file, 3 paused readers (each received 64 KiB), pool size 2: 0 non-idle sessions; `/me` 200 in 6 ms, `/readyz` 200 in 3 ms. It passes on HEAD and after. |
| Every JSON-body operation (all other mutations) | Fastify's content-type parser receives the whole body during the parsing stage, before `preValidation` (authentication, the first DB query) and before the handler. No connection exists while the body arrives. Handlers send their reply after the transaction commits (`reply.send` does not wait for the client). An aborted body, however, was a 500 (F-DG2-412). | Unchanged order. Aborted bodies now map centrally (below). |
| Identity `preValidation` (session, grants) | Single queries on `db`, each releasing its connection. For the upload the body is not read yet, but no transaction spans the wait. | Unchanged. |
| `GET /readyz` | `pool.connect()` … `client.release()` in `finally`, before the reply. With an exhausted pool it waited forever. | Unchanged, plus the bounded checkout: with an exhausted pool it answers its existing 503 `not_ready` after the checkout timeout (403 ms in the test with a 400 ms timeout). |
| Denied-mutation audit (`onError` hook), login/session rotation, idempotent replay | A short transaction with database work only, and the reply after the commit. | Unchanged. |
| Worker (`handlers.ts`, `relay.ts`) | Transactions with database work only. `boss.send` in the relay uses the same transaction's executor (DB-only), and there is no HTTP client I/O. | Unchanged; now bounded by the pool settings below. |
| `mth-db` CLI | `migrate` uses its own `pg.Client` (not `createPool`); `status`/`bootstrap`/`seed-dev` use short transactions. | Unchanged. `createPool`'s bounds apply to the CLI pool; `migrate` is unaffected. |

**Defence in depth on the pool** (`packages/db/src/pool.ts`; documented in `docs/operations/health-readiness.md`):

- **`connectionTimeoutMillis = 10 s`** (`DEFAULT_CONNECTION_TIMEOUT_MS`). pg's default 0 waited forever.
  - On expiry, the API answers 503 `unavailable` (`mapError` → `isPoolCheckoutTimeout`, logged at error level as
    `request failed`), and `/readyz` gives its existing 503 `not_ready`.
  - A worker job fails and is retried with backoff.
  - 10 s is far above a healthy checkout and far below `requestTimeout`.
- **`idle_in_transaction_session_timeout = 30 s`** (`DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS`).
  - PostgreSQL ends a session that is idle inside an open transaction, which releases its locks.
  - No application transaction waits on anything but the database (see the sweep), so its idle gaps are
    microseconds. 30 s matches `statement_timeout`.
- **Per-client `error` listener.** pg-pool removes its own listener while a client is checked out. A server-side session
  end (25P03 from the setting above, or an administrator's termination) or a socket reset on a checked-out client would
  otherwise be an **uncaught exception** in the process. The pending query still fails, and the client is discarded on
  release. `pool-bounds.test.ts` exercises this with no listener of its own.
- **Not broken:**
  - migrate is a separate `pg.Client`, unaffected;
  - seed/bootstrap: `packages/db/test/integration/bootstrap.test.ts` and `catalogue.test.ts`;
  - worker: `apps/worker/test/integration/**`.

  All are green in both integration runs per locale (§6).
- **Contract note.** 503 is in ADR-0007 §3's status table and the `Problem.type` enum
  (`urn:mth:problem:unavailable`), but the contract declares it per operation only on `getReadiness`. Like 500 (D-067),
  a 503 from an exhausted pool is an operational failure, not a contract response. The contract is unchanged; see §4.

### F-DG2-412 (REQ-DLV-034): an incomplete body is never a 500

`isIncompleteBodyError` (`platform/hooks.ts:82`) is checked first in `mapError`, right after `HttpProblem`, so it
covers `setErrorHandler` and the router-level `frameworkErrors` handler. It matches only when **all** of these hold:

1. `request.raw.complete === false`: the body really did not arrive. `inject` has no such flag and never matches.
2. The error has no `syscall`. A database socket reset is `read ECONNRESET` with `syscall: "read"`; pg protocol
   errors carry SQLSTATE codes.
3. It is Node's request-abort error (`code ECONNRESET`, message `aborted`; Fastify's rawBody stamps `statusCode 400`
   on it), or `ERR_STREAM_PREMATURE_CLOSE` on a request Node marked `aborted`/`destroyed`.

The answer is the declared 400 `validation.malformed_request` ("The request body was not received completely."). It is
logged at **info** as `request body not received completely`, never `unhandled error`. The rule is the same for JSON
and octet-stream, and for client disconnect and `requestTimeout`. The route-local `abortedBodyProblem` is removed;
the upload now rethrows into the central rule.

A genuine fault stays a 500 with an error log. The unit tests check the abort-shaped error on a complete request and
the DB reset during an incomplete body. The integration test checks a real `read ECONNRESET` from PostgreSQL through
a resetting TCP proxy while the upload body is still arriving.

## 3. Tests added

**Integration, real sockets** (`apps/api/test/integration/request-io.test.ts`, 10 tests, disposable PostgreSQL 16).
Each test logs a `BE17 <key>: {…}` line.

1. **Reviewer's R8.** 5 stalled uploads (Content-Length 10 MiB, 1 KiB sent) on an instance with pool size 5.
   - Session states are read as superuser: the app role sees `state = NULL`, which made the reviewer's `"s":null`;
     the test asserts that every session is visible.
   - 0 sessions idle in transaction; `/me` and `/readyz` 200 promptly (under 2 s); a `PATCH` of a stalled item 200.
   - No object or `.part` is left, no content row is written, and no error-level log appears.
2. **Stale `If-Match` during the body.** 256 KiB upload, 1 KiB sent, then the item is edited through the API.
   - The edit answers 200 at once (on HEAD it blocked on the row lock).
   - Then the rest of the body is sent: 409 `version_conflict` with `currentVersion` = v + 1.
   - No content row, no object, no `.part`; the version is the edit's.
3. **Valid uploads.** 1 B, 64 KiB and 3 MiB over a real socket.
   - 200 with version + 1 and one content row whose sha256 and size match.
   - The download is byte-exact, and exactly one final object (no `.part`) is left.
4. **Sweep, slow readers.** 3 paused downloads of a 24 MiB file with pool size 2: `/me` and `/readyz` 200 promptly and
   0 non-idle sessions.
5. **Exhausted pool.** All of an instance's connections (pool 2, checkout timeout 400 ms) are held.
   - `/me` gets 503 `unavailable` in 408 ms, and `/readyz` 503 in 403 ms.
   - `/me` answers 200 after the connections are released.
6. **R6a.** Stalled JSON body with `requestTimeout` 1.5 s: 408; the body is classified as incomplete at info level; no
   error-level line and no ≥ 500 response.
7. **R6d.** JSON body aborted by the client: the same.
8. **R6c.** Stalled upload with `requestTimeout`: 408, classified, nothing stored.
9. **R6e.** Upload aborted by the client: classified, nothing stored.
10. **No over-match.** A TCP proxy in front of PostgreSQL resets every connection, while an upload's body is still
    arriving.
    - The session lookup fails with a real `read ECONNRESET`.
    - Result: 500 `internal`, an error-level `unhandled error` with `err.code ECONNRESET`, and **no**
      `request body not received completely` line.

    This test writes one error-level log line on purpose (§6).

**Integration, `packages/db/test/integration/pool-bounds.test.ts`** (7 tests):

- session settings: `statement_timeout` 30 s, `idle_in_transaction_session_timeout` 30 s, UTC; checkout timeout 10 s;
- URL `options` kept alongside the pool's own options;
- the checkout timeout fires (never hangs), is recognised, and the pool recovers, both directly and through Kysely;
- other errors are not recognised as a checkout timeout;
- idle-in-transaction termination releases the transaction's lock without an uncaught exception, and the pool recovers;
- a busy transaction (statements running for 1 s against a 400 ms limit) is not affected.

**Unit tests:**

- `incomplete-body.test.ts` (10 tests): the matcher matrix (abort, premature close, complete or `inject`, DB reset,
  pg 57P01, plain ECONNRESET without `aborted`, non-objects); `problemForError` (400, 500, and 503 for both pg
  messages); `setErrorHandler`'s status and log level for each class.
- `evidence.test.ts`: 3 new store tests (`receive` / `finalise` visibility, `discardUncommitted` of a `.part`, a failing
  stream leaves nothing) and the S3 stub.

**Negative control** (`negative-control-head-18694ca.log`; script `negative-control-commands.log`).

- **Setup.** The 6 changed source files were replaced by `git show HEAD:<path>` while the final tests and the harness
  option stayed. After the run they were copied back from a backup, and the log records `restored <file>` for each.
  git metadata was never written.
- **Integration: exit 1, `Tests 13 failed | 4 passed (17)`.** The 4 that pass on HEAD are the expected controls:
  - the valid-upload positive control;
  - the slow-reader download (already correct on HEAD);
  - the DB-reset over-match control;
  - the busy-transaction control.

  Every F-411/F-412 test fails. HEAD's R8 line shows `idleInTx: 5`, and `/me`, `/readyz` and `PATCH` all `-1` after
  5 s. The stale-If-Match line shows `PATCH` blocked for 3 s and the upload committed (200). R6a and R6d show the
  level-50 `aborted` line.
- **Unit: exit 1, `Tests 11 failed | 10 passed (21)`.** Every new unit test fails, except the controls that are 500 on
  HEAD as well, and the pre-existing tests.
- **R6c/R6e on HEAD:** no error-level line there either (BE16's route-local fix). They fail on HEAD only because the
  central classification line is missing; that is not a defect of HEAD's upload route.
- **R6a/R6d on HEAD** fail first on the missing classification. Their `BE17` lines also show the level-50 `aborted`
  (ECONNRESET) "unhandled error" of F-DG2-412.
- **A test timeout on HEAD.** The exhausted-pool test hit its **60 s test timeout** (`Test timed out in 60000ms`). Its
  first `/me` is raced against 5 s, but the second call, which reads the problem body, is not. On HEAD that checkout
  never returns, because pg's default `connectionTimeoutMillis` is 0. That is the defect itself. With the fix the same
  call answers 503 in about 0.4 s, and the recorded matrix has no timeout.
- **The stale-If-Match test on HEAD** fails at "the edit answers promptly": the `PATCH` was still blocked on the
  upload's row lock after 3 s. Once the body was completed, the upload committed and the `PATCH` got 409 (3,025 ms).
  The upload's `status` in that log line reads `"active"` because my log spreads the 200 response body over the
  status field; the test's assertion uses the HTTP status.

## 4. Known gaps / not done

- **Finding closure is not mine.** A non-author reviewer (code-security-reviewer) must verify F-DG2-411 and F-DG2-412.
- **Finalise order (§2).** The rename happens just before COMMIT, not after it, for integrity. The orchestrator should
  confirm the interpretation of "Commit, then finalise … exactly as today".
- **503 is not declared per operation.** Only `getReadiness` declares 503. An exhausted pool now gives a bounded 503
  `unavailable` (ADR-0007 §3 table, `Problem.type` enum) instead of a hang. Like 500 (D-067), it is an operational
  failure, not a contract response. Making that explicit in ADR-0007 §5b, or declaring 503, is a solution-architect
  change; I edited neither `openapi.yaml` nor the ADR.
- **The pool bounds are code constants** (overridable per pool through `PoolOptions`). There is no environment variable
  for them yet, the same as BE16's `requestTimeout` and shutdown grace.
- **`isPoolCheckoutTimeout` matches pg-pool's message strings**, because node-postgres gives these errors no code.
  `pool-bounds.test.ts` pins them against the installed pg 8.16.3 / pg-pool 3.14.0, so an upgrade that changes them
  fails that test. It doesn't silently degrade to 500.
- **A DB reset in the middle of an extended-protocol query** surfaces in pg 8.16.3 as `Connection terminated
  unexpectedly`, with no code. It is a 500 either way; the over-match test uses a reset at connection setup, which
  produces the real `read ECONNRESET`. I observed this in a standalone repro; no log is kept.
- **The upload makes two authorization passes** (phase 1 and phase 3). A refusal in phase 3 (a grant revoked during the
  body) gets the same 403 and the denied-mutation audit. The received bytes are discarded.

## 5. Merge instructions

- No migrations and no contract change. Apply the diff of the files in §1.
- `EvidenceStore` gained two methods (`receive`, `finalise`). The only implementations are in `store.ts`.
- Expect conflicts only if another change touches the upload handler, `platform/hooks.ts` `mapError` or
  `packages/db/src/pool.ts`.
- `startApi({ pool })` is additive; existing callers are unchanged.

## 6. Checks actually run (Self-verification)

**The matrix.** The script is recorded verbatim in `T-DG2-BE17-evidence/matrix-commands.log`. It was run once per
locale setting, one after the other, on the final tree:

- `nolocale`: `env -u LANG -u LC_ALL -u LC_CTYPE …`;
- `cutf8`: the same with `LANG=C.UTF-8`.

Each check writes `<mode>-<id>.log`, with the command, the Node version, the locale variables and the exit status. The
summaries are `nolocale-00-summary.log` and `cutf8-00-summary.log`.

| # | Command (Node 24.21.0 unless stated) | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` | exit 0 | exit 0 |
| 04 | `pnpm format:check` | **exit 2**: only the 12 sandbox-masked files (`.bash_profile` … `CLAUDE.local.md`, `EACCES`); every readable file: "All matched files use Prettier code style!" | same |
| 05 | `npx prettier --check . '!.bash_profile' …` (excluding the masked files) | exit 0, "All matched files use Prettier code style!" | same |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | same |
| 07 | `pnpm test` (Node 22.22.2) | exit 0, Test Files 42 passed (42), Tests 784 passed (784) | same |
| 08 | `pnpm test` (Node 24.21.0) | exit 0, 42 / 784 passed | same |
| 09a | `tests/qa/support/with-pg.sh pnpm test:integration`, run 1 | exit 0, Test Files 37 passed (37), Tests 600 passed (600) | same |
| 09b | the same, run 2 | exit 0, 37 / 600 passed | same |
| 09c | Node 22.22.2: `with-pg.sh npx vitest run --project integration` on `request-io`, `pool-bounds`, `connection-hygiene`, `evidence`, `contract/contract` and `media-types` | exit 0, Test Files 6 passed (6), Tests 75 passed (75) | same |
| 10 | `apps/web/e2e/support/with-stack.sh npx playwright test journeys.spec.ts p2-journeys.spec.ts p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` (pre-installed Chromium, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` never run) | exit 0, `60 passed (3.7m)` | exit 0, `60 passed (3.7m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | same |

The integration runs (09a/09b) include every package's integration tests:

- the new `request-io.test.ts` (10) and `pool-bounds.test.ts` (7);
- the existing evidence, BE16 connection-hygiene, media-types, invalid-utf8, dg2-repairs and contract suites;
- the worker and `packages/db` suites (migrate, bootstrap/seed, catalogue).

The counts went from BE16's 35 files / 583 tests to 37 / 600 (+17 new). The unit counts went from 41 / 771 to
42 / 784 (+10 in `incomplete-body.test.ts`, +3 in `evidence.test.ts`).

**Before/after extracts.** `sweep-before-18694ca.log` holds the `BE17` lines of the negative control (HEAD source).
`sweep-after.log` holds those of `nolocale-09a`.

**Disclosure of every non-zero exit, failure, warning and error-level line:**

- **Non-zero exits in the recorded matrix:** only check 04 (`pnpm format:check`, exit 2) in both modes. The cause is
  the 12 dotfiles the sandbox masks (`EACCES`); check 05 excludes them and exits 0.
- **Failure markers.** I grepped every matrix log for `Hook timed out`, `Failed Suites`, `Failed Tests`, ` FAIL `, `✗`
  and `×`, and found none.
- **Error-level log lines.** Exactly one line per integration run (09a, 09b, 09c × 2 modes = 6), always the same: the
  deliberate **over-match control**. Its output is `BE17 db-econnreset: {"status":500,…,"errors":[{"msg":"unhandled
  error","code":"ECONNRESET","message":"read ECONNRESET"}]}`. That test **asserts** this error-level line (a genuine
  database fault must stay a 500 with an error log). No other test logged at error level.
- **Warnings that predate this change:** `[FSTDEP022] FastifyWarning` (router constraints access) in the unit logs, and
  Vite's chunk-size advisory (`chunkSizeWarningLimit`) in the build logs. BE16's logs have both.
- **The negative control (§3) exits 1 by design.** Integration: 13 failed | 4 passed (17); unit: 11 failed | 10 passed
  (21).
- **Superseded runs:**
  1. **First negative control.** Its log was overwritten, not used. It ran with an earlier `pool-bounds.test.ts`
     whose `afterAll` hook timed out on HEAD (`Hook timed out in 30000ms`): HEAD's unbounded checkout never returned,
     so the pool could not be closed. I capped the waits in the test (5 s per checkout, 3 s per close), and the
     recorded negative control has no hook timeout. I re-ran the negative control twice more after adding and fixing
     tests; the recorded log is the last run, on the final tests.
  2. **First full matrix** (`T-DG2-BE17-evidence/superseded-run1/`, kept for transparency, not evidence).
     - Check 01 (typecheck) **exited 2** in both modes: an implicitly typed `items` array in my new
       `request-io.test.ts` (TS7034/TS7005). Vitest does not typecheck, so the tests had passed.
     - Check 04 exited 2 for the masked dotfiles, as above.
     - Every other check exited 0.
     - While it ran I decided to add the slow-reader download test. I couldn't stop the run (my shell runs in a
       separate PID namespace), so I let it finish. Then I fixed the typing, added the test, and replaced the
       vacuous `pg_stat_activity` check (see the next point). The recorded matrix ran once per mode afterwards, on
       the final tree.
  3. **A vacuous check, found and fixed before the recorded runs.** My first R8 test read `pg_stat_activity` as
     `mth_app`, which sees `state = NULL` for these sessions. It would have reported "0 idle in transaction" even on
     HEAD (the reviewer's probe shows the same `"s":null`). The final test reads the states as the cluster superuser
     and asserts that every session's state is visible. On HEAD it now reports `idleInTx: 5`.
- **Failures during development, all fixed before the recorded matrix:**
  - The DB-reset test first saw `Connection terminated unexpectedly` instead of `ECONNRESET`: pg reports a RST in the
    middle of an extended-protocol query that way. The final proxy resets at connection setup, which gives a real
    `read ECONNRESET`.
  - The slow-reader test first paused its readers too late: loopback had delivered all 24 MiB already. The final test
    pauses before sending the request.
- **After the matrix** I wrote only this handback and the two sweep extracts. They are under `docs/`, which
  `.prettierignore` excludes, so the format checks don't cover them. No source, test, configuration or operations
  document changed after the matrix started.
